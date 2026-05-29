#!/usr/bin/env python3
"""
AWS SAA-C03 exam dump PDF parser and Korean translator.
Downloads PDF from GitHub, parses questions, translates to Korean,
saves as markdown files in practice/ directory.
"""

import re
import os
import sys
import time
import urllib.request
from pathlib import Path

PDF_URL = (
    "https://raw.githubusercontent.com/Iamrushabhshahh/"
    "AWS-Certified-Solutions-Architect-Associate-SAA-C03-Exam-Dump-With-Solution/"
    "main/AWS%20Certified%20Solutions%20Architect%20Associate%20SAA-C03.pdf"
)
PDF_PATH = Path("aws-saa-c03.pdf")
PRACTICE_DIR = Path("practice")
QUESTIONS_PER_FILE = 20
TRANSLATE_DELAY = 0.3  # seconds between API calls to avoid rate limit


def download_pdf():
    if PDF_PATH.exists():
        print(f"PDF already exists: {PDF_PATH}")
        return
    print("Downloading PDF...")
    urllib.request.urlretrieve(PDF_URL, PDF_PATH)
    print(f"Downloaded: {PDF_PATH} ({PDF_PATH.stat().st_size // 1024} KB)")


def extract_text(pdf_path: Path) -> str:
    import fitz  # PyMuPDF
    doc = fitz.open(pdf_path)
    pages = []
    for page in doc:
        pages.append(page.get_text())
    doc.close()
    return "\n".join(pages)


def parse_questions(text: str) -> list[dict]:
    """
    Parse questions from PDF text.
    Expected format:
        Question #N
        <question text>
        A. <option>
        B. <option>
        C. <option>
        D. <option>
        Correct Answer: X
    """
    # Split on question boundaries
    question_pattern = re.compile(
        r"Question\s*#?\s*(\d+)",
        re.IGNORECASE,
    )

    blocks = question_pattern.split(text)
    # blocks: ['preamble', '1', '<rest of q1>', '2', '<rest of q2>', ...]

    questions = []
    i = 1
    while i < len(blocks) - 1:
        num = blocks[i].strip()
        body = blocks[i + 1]
        i += 2

        q = parse_question_block(num, body)
        if q:
            questions.append(q)

    return questions


def parse_question_block(num: str, body: str) -> dict | None:
    # Extract options A-D (sometimes E)
    option_pattern = re.compile(r"\n([A-E])\.\s+(.+?)(?=\n[A-E]\.|Correct Answer|$)", re.DOTALL)
    options = {}
    for m in option_pattern.finditer(body):
        options[m.group(1)] = m.group(2).strip().replace("\n", " ")

    # Extract correct answer
    answer_match = re.search(r"Correct Answer[:\s]+([A-E]+)", body, re.IGNORECASE)
    if not answer_match:
        return None
    answer = answer_match.group(1).strip()

    # Extract question text (everything before first option)
    first_option = re.search(r"\n[A-E]\.", body)
    if first_option:
        question_text = body[: first_option.start()].strip().replace("\n", " ")
    else:
        return None

    if not question_text or not options:
        return None

    return {
        "num": int(num),
        "question": question_text,
        "options": options,
        "answer": answer,
    }


def translate_text(translator, text: str) -> str:
    if not text.strip():
        return text
    try:
        result = translator.translate(text)
        time.sleep(TRANSLATE_DELAY)
        return result
    except Exception as e:
        print(f"  Translation error: {e}", file=sys.stderr)
        return text  # fallback to original


def translate_question(translator, q: dict) -> dict:
    print(f"  Translating Q{q['num']}...", end=" ", flush=True)
    translated = {
        "num": q["num"],
        "question": translate_text(translator, q["question"]),
        "options": {
            k: translate_text(translator, v) for k, v in q["options"].items()
        },
        "answer": q["answer"],
        "original_question": q["question"],
        "original_options": q["options"],
    }
    print("done")
    return translated


def question_to_markdown(q: dict) -> str:
    lines = [f"## Q{q['num']}"]
    lines.append("")
    lines.append(q["question"])
    lines.append("")
    for k, v in q["options"].items():
        lines.append(f"- **{k}.** {v}")
    lines.append("")
    lines.append(f"<details>")
    lines.append(f"<summary>정답 보기</summary>")
    lines.append("")
    lines.append(f"**정답: {q['answer']}**")
    lines.append("")
    # Show original English for reference
    lines.append("**원문:**")
    lines.append(f"> {q['original_question']}")
    lines.append("")
    for k, v in q["original_options"].items():
        lines.append(f"> - {k}. {v}")
    lines.append("")
    lines.append("</details>")
    lines.append("")
    return "\n".join(lines)


def save_batch(questions: list[dict], batch_num: int, start: int, end: int):
    filename = PRACTICE_DIR / f"q{start:04d}-{end:04d}.md"
    header = f"# AWS SAA-C03 연습 문제 (Q{start}–Q{end})\n\n"
    body = "\n---\n\n".join(question_to_markdown(q) for q in questions)
    filename.write_text(header + body, encoding="utf-8")
    print(f"Saved: {filename}")


def main():
    download_pdf()

    print("Extracting text from PDF...")
    text = extract_text(PDF_PATH)

    print("Parsing questions...")
    questions = parse_questions(text)
    print(f"Found {len(questions)} questions")

    if not questions:
        print("No questions parsed. Check PDF format.")
        sys.exit(1)

    PRACTICE_DIR.mkdir(exist_ok=True)

    from deep_translator import GoogleTranslator
    translator = GoogleTranslator(source="en", target="ko")

    total = len(questions)
    batch_questions = []
    batch_start = questions[0]["num"]

    for i, q in enumerate(questions):
        translated = translate_question(translator, q)
        batch_questions.append(translated)

        is_last = i == total - 1
        is_batch_full = len(batch_questions) == QUESTIONS_PER_FILE

        if is_batch_full or is_last:
            batch_end = translated["num"]
            save_batch(batch_questions, len(batch_questions), batch_start, batch_end)
            batch_questions = []
            if not is_last:
                batch_start = questions[i + 1]["num"]

    print(f"\nDone! {total} questions saved to {PRACTICE_DIR}/")


if __name__ == "__main__":
    main()
