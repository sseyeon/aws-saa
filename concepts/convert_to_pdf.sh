#!/bin/zsh

# 사용법:
#   ./convert_to_pdf.sh          → 통합 PDF 1개 (기본값)
#   ./convert_to_pdf.sh --all    → 파일별 개별 PDF
#   ./convert_to_pdf.sh --merge  → 통합 PDF 1개

SCRIPT_DIR="$(dirname "$0")"
MODE="merge"

case "$1" in
  --all)   MODE="all" ;;
  --merge) MODE="merge" ;;
  "")      MODE="merge" ;;
  *) echo "사용법: $0 [--merge|--all]"; exit 1 ;;
esac

latex_replace() {
  sed \
    -e 's/\$\\rightarrow\$/→/g' \
    -e 's/\$\\leftarrow\$/←/g' \
    -e 's/\$\\Rightarrow\$/⇒/g' \
    -e 's/\$\\Leftarrow\$/⇐/g' \
    -e 's/\$\\leftrightarrow\$/↔/g' \
    "$1"
}

if [[ "$MODE" == "merge" ]]; then
  TMP_FILE="$SCRIPT_DIR/aws-saa-concepts.md"
  first=true
  for md_file in "$SCRIPT_DIR"/*.md(n); do
    if $first; then first=false; else printf '\n<div style="page-break-after: always;"></div>\n\n' >> "$TMP_FILE"; fi
    cat "$md_file" >> "$TMP_FILE"
  done
  sed -i '' \
    -e 's/\$\\rightarrow\$/→/g' \
    -e 's/\$\\leftarrow\$/←/g' \
    -e 's/\$\\Rightarrow\$/⇒/g' \
    -e 's/\$\\Leftarrow\$/⇐/g' \
    -e 's/\$\\leftrightarrow\$/↔/g' \
    "$TMP_FILE"
  echo "변환 중 (통합)..."
  npx md-to-pdf "$TMP_FILE" \
    --pdf-options '{"format":"A4","margin":{"top":"20mm","right":"20mm","bottom":"20mm","left":"20mm"}}' \
    > /dev/null 2>&1 && echo "완료: $SCRIPT_DIR/aws-saa-concepts.pdf" || echo "변환 실패"
  rm -f "$TMP_FILE"

else
  OUTPUT_DIR="$SCRIPT_DIR/pdf"
  mkdir -p "$OUTPUT_DIR"
  success=0; fail=0
  for md_file in "$SCRIPT_DIR"/*.md(n); do
    filename="$(basename "$md_file" .md)"
    tmp_file="$OUTPUT_DIR/${filename}.md"
    latex_replace "$md_file" > "$tmp_file"
    if npx md-to-pdf "$tmp_file" \
      --pdf-options '{"format":"A4","margin":{"top":"20mm","right":"20mm","bottom":"20mm","left":"20mm"}}' \
      > /dev/null 2>&1; then
      echo "✓ $filename"
      ((success++))
    else
      echo "✗ $filename (실패)"
      ((fail++))
    fi
    rm -f "$tmp_file"
  done
  echo "\n완료: 성공 ${success}개 / 실패 ${fail}개 → $OUTPUT_DIR"
fi
