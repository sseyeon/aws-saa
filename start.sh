#!/bin/bash
# AWS SAA-C03 Exam Simulator launcher

cd "$(dirname "$0")"

# Step 1: Build questions.json if not present
if [ ! -f "practice/questions.json" ]; then
  echo "=== questions.json not found. Running build script first... ==="
  .venv/bin/python build_questions.py
fi

# Step 2: Serve
echo ""
echo "=== Starting local server ==="
echo "Open: http://localhost:8080"
echo "Press Ctrl+C to stop"
echo ""
cd practice && python3 -m http.server 8080
