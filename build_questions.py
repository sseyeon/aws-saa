#!/usr/bin/env python3
"""
AWS SAA-C03 exam dump parser + Korean translator.
Usage: .venv/bin/python build_questions.py

Reads:
  - aws-saa-c03.pdf      (questions)
  - aws-saa-solution.txt (answers + explanations, downloaded from GitHub)
Outputs:
  - practice/questions.json
"""

import re
import sys
import json
import time
import urllib.request
from pathlib import Path

PDF_URL = (
    "https://raw.githubusercontent.com/Iamrushabhshahh/"
    "AWS-Certified-Solutions-Architect-Associate-SAA-C03-Exam-Dump-With-Solution/"
    "main/AWS%20Certified%20Solutions%20Architect%20Associate%20SAA-C03.pdf"
)
TXT_URL = (
    "https://raw.githubusercontent.com/Iamrushabhshahh/"
    "AWS-Certified-Solutions-Architect-Associate-SAA-C03-Exam-Dump-With-Solution/"
    "main/AWS%20SAA-03%20Solution.txt"
)
PDF_PATH = Path("aws-saa-c03.pdf")
TXT_PATH = Path("aws-saa-solution.txt")
OUT_PATH = Path("practice/questions.json")
TRANSLATE_DELAY = 0.25

# Topic detection: (display_name, [keywords...])
TOPICS = [
    ("S3",        ["S3 bucket", "S3 Transfer Acceleration", "S3 Glacier", "Simple Storage Service",
                   "multipart upload", "S3 Lifecycle", "S3 Object Lock", "S3 Intelligent"]),
    ("Storage",   ["EBS", "EFS", "FSx", "Storage Gateway", "Snowball", "Snow Family",
                   "NFS", "SMB file", "Elastic Block Store", "Elastic File System", "file gateway"]),
    ("데이터전송", ["DataSync", "Transfer Family", "Direct Connect", "AWS VPN", "Site-to-Site VPN",
                   "Application Migration Service", "Database Migration", "DMS", "Snow"]),
    ("데이터베이스", ["RDS", "Aurora", "DynamoDB", "ElastiCache", "Redshift", "Neptune",
                    "DocumentDB", "QLDB", "database", "MySQL", "PostgreSQL", "Oracle"]),
    ("컴퓨팅1",   ["EC2 instance", "Auto Scaling group", "AMI", "Spot Instance", "Reserved Instance",
                   "On-Demand", "Launch Template", "placement group", "EC2 Auto Scaling"]),
    ("컴퓨팅2",   ["Lambda", "Fargate", "ECS", "EKS", "container", "Kubernetes", "serverless"]),
    ("컴퓨팅3",   ["Elastic Beanstalk", "App Runner", "AWS Batch", "Step Functions", "OpsWorks",
                   "Lightsail", "Outposts"]),
    ("네트워크1",  ["VPC", "subnet", "CIDR", "NAT gateway", "Internet Gateway", "Transit Gateway",
                   "VPC endpoint", "PrivateLink", "VPC peering", "network ACL"]),
    ("네트워크2",  ["Route 53", "CloudFront", "Application Load Balancer", "Network Load Balancer",
                   "API Gateway", "Global Accelerator", "ALB", "NLB", "ELB", "Elastic Load"]),
    ("데이터분석", ["Athena", "Kinesis", "Glue", "EMR", "QuickSight", "OpenSearch", "Elasticsearch",
                   "Lake Formation", "data lake", "analytics"]),
    ("보안1",     ["IAM", "role", "identity", "Organizations", "SCP", "Control Tower",
                   "Service Control Policy", "permission boundary"]),
    ("보안2",     ["KMS", "CloudHSM", "Secrets Manager", "Parameter Store", "Certificate Manager",
                   "ACM", "encryption key", "CMK"]),
    ("보안3",     ["Shield", "WAF", "GuardDuty", "Macie", "Inspector", "Security Hub",
                   "AWS Config", "CloudTrail", "firewall", "DDoS"]),
    ("비용관리",  ["Cost Explorer", "Budgets", "Savings Plan", "cost optimization", "billing",
                   "Reserved Capacity", "Compute Optimizer"]),
    ("모니터링",  ["CloudWatch", "X-Ray", "EventBridge", "SNS topic", "SQS", "notification",
                   "alarm", "metrics", "logs"]),
]


# ── Download ─────────────────────────────────────────────────────────────────

def download(url: str, dest: Path):
    if dest.exists():
        print(f"  Already exists: {dest}")
        return
    print(f"  Downloading {dest.name}...")
    urllib.request.urlretrieve(url, dest)
    print(f"  Done ({dest.stat().st_size // 1024} KB)")


# ── PDF parsing ───────────────────────────────────────────────────────────────

def extract_pdf_text(pdf_path: Path) -> str:
    import fitz
    doc = fitz.open(pdf_path)
    pages = [page.get_text() for page in doc]
    doc.close()
    return "\n".join(pages)


def parse_pdf_questions(text: str) -> dict[int, dict]:
    """Returns {num: {question, options, multi_answer}}"""
    q_split = re.compile(r"Question\s*#?\s*(\d+)", re.IGNORECASE)
    parts = q_split.split(text)
    # parts = ['preamble', '1', 'body1', '2', 'body2', ...]

    questions = {}
    i = 1
    while i < len(parts) - 1:
        num = int(parts[i].strip())
        body = parts[i + 1]
        i += 2

        q = _parse_q_body(num, body)
        if q:
            questions[num] = q
    return questions


def _parse_q_body(num: int, body: str) -> dict | None:
    # Find first option position
    opt_start = re.search(r"\n([A-E])\.", body)
    if not opt_start:
        return None

    question_text = body[: opt_start.start()].strip().replace("\n", " ")
    question_text = re.sub(r"\s{2,}", " ", question_text)

    # Extract options
    opt_pattern = re.compile(r"\n([A-E])\.\s+(.+?)(?=\n[A-E]\.|$)", re.DOTALL)
    options = {}
    for m in opt_pattern.finditer(body):
        val = m.group(2).strip().replace("\n", " ")
        val = re.sub(r"\s{2,}", " ", val)
        # Remove trailing "Topic 1 Question #N" noise
        val = re.sub(r"\s*Topic\s+\d+.*$", "", val).strip()
        options[m.group(1)] = val

    if not question_text or len(options) < 2:
        return None

    multi = bool(re.search(r"Choose\s+(two|three|2|3)", question_text, re.IGNORECASE))
    return {"question": question_text, "options": options, "multi_answer": multi}


# ── Solution TXT parsing ──────────────────────────────────────────────────────

def parse_solution_txt(text: str, pdf_qs: dict | None = None) -> dict[int, dict]:
    """Returns {num: {answer, explanation}}"""
    blocks = re.split(r"-{3,}", text)
    solutions = {}

    for block in blocks:
        block = block.strip()
        if not block:
            continue
        num_m = re.match(r"^(\d+)\]", block)
        if not num_m:
            continue
        num = int(num_m.group(1))

        pdf_options = pdf_qs[num]["options"] if pdf_qs and num in pdf_qs else None
        answer = _extract_answer_letter(block, pdf_options)
        explanation = _extract_explanation(block)

        solutions[num] = {"answer": answer or "", "explanation": explanation}

    return solutions


def _extract_answer_letter(block: str, pdf_options: dict | None = None) -> str | None:
    # Strategy 1: "Correct answer X" explicit
    m = re.search(r"Correct answer\s+([A-E])[\s:,]", block, re.IGNORECASE)
    if m:
        return m.group(1).upper()

    # Strategy 2: "ans- X." or "ans-X."
    m = re.search(r"ans-\s*([A-E])\.", block, re.IGNORECASE)
    if m:
        return m.group(1).upper()

    # Strategy 3: bare answer line "A. text" or "  B text" (no dot) anywhere in block
    # Take the FIRST such line that appears after the question text
    question_end = _find_question_end(block)
    post_q = block[question_end:]
    for line in post_q.splitlines():
        # "A. text" or "  A  text"
        m = re.match(r"^\s*([A-E])[\.\s]\s*\S", line)
        if m:
            return m.group(1).upper()

    # Strategy 4: "ans-" text → fuzzy match against PDF options
    ans_m = re.search(r"ans-\.?\s*(.{10,})", block, re.IGNORECASE)
    if ans_m and pdf_options:
        ans_text = ans_m.group(1).strip().lower()[:80]
        best_letter, best_score = None, 0
        for letter, opt_text in pdf_options.items():
            # Overlap: count shared words
            a_words = set(ans_text.split())
            b_words = set(opt_text.lower().split())
            score = len(a_words & b_words)
            if score > best_score:
                best_score, best_letter = score, letter
        if best_score >= 2:
            return best_letter

    return None


def _find_question_end(block: str) -> int:
    """Find the character position where the question text ends."""
    # Questions end at a line ending with '?'
    for m in re.finditer(r"\?\s*\n", block):
        return m.end()
    return len(block) // 3  # fallback


def _extract_explanation(block: str) -> str:
    # Everything after "ans-" line
    ans_idx = block.lower().find("ans-")
    if ans_idx >= 0:
        raw = block[ans_idx + 4:].strip()
        # Remove leading answer letter like "A. text" first line
        raw = re.sub(r"^[A-E]\.\s+", "", raw, count=1)
        return raw[:2000].strip()
    return ""


# ── Topic detection ───────────────────────────────────────────────────────────

def detect_topic(question_text: str, options_text: str) -> str:
    combined = question_text + " " + options_text
    for topic_name, keywords in TOPICS:
        for kw in keywords:
            if kw.lower() in combined.lower():
                return topic_name
    return "기타"


# ── Translation ───────────────────────────────────────────────────────────────

def make_translator():
    from deep_translator import GoogleTranslator
    return GoogleTranslator(source="en", target="ko")


def translate(translator, text: str) -> str:
    if not text or not text.strip():
        return text
    try:
        result = translator.translate(text[:4900])
        time.sleep(TRANSLATE_DELAY)
        return result
    except Exception as e:
        print(f"\n  [warn] translation failed: {e}")
        return text


SEP = "\n||||\n"  # separator for batched translation


def translate_question(translator, q: dict) -> dict:
    # Batch question + all options in one API call
    options = q["options"]
    parts = [q["question"]] + [f"{k}. {v}" for k, v in options.items()]
    batch = SEP.join(parts)

    translated_batch = translate(translator, batch[:4900])
    translated_parts = translated_batch.split(SEP.strip()) if SEP.strip() in translated_batch else translated_batch.split("||||")

    ko_question = translated_parts[0].strip() if len(translated_parts) > 0 else q["question"]
    ko_options = {}
    for i, (letter, _) in enumerate(options.items()):
        raw = translated_parts[i + 1].strip() if i + 1 < len(translated_parts) else ""
        # Strip "A. " prefix that may appear after translation
        ko_options[letter] = re.sub(r"^[A-E]\.\s*", "", raw).strip() or raw

    ko_explanation = translate(translator, q.get("explanation", "")[:1500])

    return {
        **q,
        "question_ko": ko_question,
        "options_ko": ko_options,
        "explanation_ko": ko_explanation,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=== AWS SAA-C03 Question Builder ===\n")

    # Download
    print("[1/5] Downloading files...")
    download(PDF_URL, PDF_PATH)
    download(TXT_URL, TXT_PATH)

    # Parse PDF
    print("\n[2/5] Parsing PDF questions...")
    pdf_text = extract_pdf_text(PDF_PATH)
    pdf_qs = parse_pdf_questions(pdf_text)
    print(f"  Found {len(pdf_qs)} questions")

    # Parse TXT
    print("\n[3/5] Parsing solution TXT...")
    txt_text = TXT_PATH.read_text(encoding="utf-8", errors="ignore")
    solutions = parse_solution_txt(txt_text, pdf_qs)
    print(f"  Found {len(solutions)} solutions")

    # Merge
    print("\n[4/5] Merging questions + answers...")
    merged = []
    missing_answer = 0
    for num in sorted(pdf_qs.keys()):
        q = pdf_qs[num]
        sol = solutions.get(num, {})
        options_text = " ".join(q["options"].values())
        entry = {
            "id": num,
            "topic": detect_topic(q["question"], options_text),
            "question": q["question"],
            "options": q["options"],
            "answer": sol.get("answer", ""),
            "explanation": sol.get("explanation", ""),
            "multi_answer": q["multi_answer"],
        }
        if not entry["answer"]:
            missing_answer += 1
        merged.append(entry)

    print(f"  Total: {len(merged)} questions ({missing_answer} missing answer)")

    # Load existing translations (checkpoint)
    Path("practice").mkdir(exist_ok=True)
    existing = {}
    if OUT_PATH.exists():
        try:
            data = json.loads(OUT_PATH.read_text())
            for q in data.get("questions", []):
                # Only use checkpoint if translation actually exists
                if q.get("question_ko"):
                    existing[q["id"]] = q
            print(f"\n  Checkpoint: {len(existing)} already translated")
        except Exception:
            pass

    # Translate
    print(f"\n[5/5] Translating to Korean...")
    print(f"  ({len(merged) - len(existing)} remaining, ~{(len(merged)-len(existing))*1.5/60:.0f} min)")

    translator = make_translator()
    result = []

    for i, q in enumerate(merged):
        qid = q["id"]
        if qid in existing:
            result.append(existing[qid])
            continue

        sys.stdout.write(f"  Q{qid} ({i+1}/{len(merged)})... ")
        sys.stdout.flush()

        translated = translate_question(translator, q)
        result.append(translated)
        existing[qid] = translated
        print("ok")

        # Save checkpoint every 10 questions
        if len(result) % 10 == 0:
            _save(result, merged)

    _save(result, merged)
    print(f"\nDone! Saved {len(result)} questions to {OUT_PATH}")


def _save(questions, merged_meta):
    topics = {}
    for q in questions:
        t = q.get("topic", "기타")
        topics.setdefault(t, []).append(q["id"])

    topic_list = [{"name": t, "ids": ids} for t, ids in topics.items()]

    data = {
        "total": len(questions),
        "topics": topic_list,
        "questions": questions,
    }
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
