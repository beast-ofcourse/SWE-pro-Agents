"""
Generate a PDF from an HTML file, trying multiple backends.

Usage:
    python scripts/generate_pdf.py input.html output.pdf [--landscape] [--paper-size A4]

Tries these methods in order (all must be preinstalled — the script never
installs packages at runtime):
  1. Playwright (via npx --no-install @playwright/test) — best quality
  2. weasyprint (pip install weasyprint)
  3. pdfkit (pip install pdfkit, needs wkhtmltopdf installed separately)
"""

import argparse
import subprocess
import sys
import os
import shutil
import tempfile
import json
import pathlib


def check_npx_tool(package: str) -> bool:
    """Check if an npx package is available (without auto-installing it)."""
    try:
        result = subprocess.run(
            ["npx", "--no-install", package, "--version"],
            capture_output=True, text=True, timeout=30
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def try_playwright(html_path: str, pdf_path: str, landscape: bool, paper_size: str) -> bool:
    """Use Playwright to print HTML to PDF."""
    # Resolve to absolute paths and build a valid file URI + JSON-escaped
    # strings so relative inputs and quotes/special chars can't break the
    # generated JavaScript.
    html_abs = os.path.abspath(html_path)
    pdf_abs = os.path.abspath(pdf_path)
    html_uri = pathlib.Path(html_abs).as_uri()
    script = f"""
const {{ chromium }} = require('playwright');
(async () => {{
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto({json.dumps(html_uri)}, {{ waitUntil: 'networkidle' }});
    await page.pdf({{
        path: {json.dumps(pdf_abs)},
        format: {json.dumps(paper_size)},
        landscape: {'true' if landscape else 'false'},
        printBackground: true,
        margin: {{ top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in' }}
    }});
    await browser.close();
}})();
"""
    tmpdir = tempfile.mkdtemp()
    script_path = os.path.join(tmpdir, "print.js")
    with open(script_path, "w") as f:
        f.write(script)

    try:
        result = subprocess.run(
            ["npx", "--no-install", "playwright", "run", script_path],
            capture_output=True, text=True, timeout=60,
            cwd=tmpdir
        )
        if result.returncode == 0 and os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 0:
            return True
        print(f"  Playwright stderr: {result.stderr[:300]}")
        return False
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"  Playwright error: {e}")
        return False
    finally:
        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass


def try_playwright_mcp(html_path: str, pdf_path: str, landscape: bool, paper_size: str) -> bool:
    """Use @playwright/mcp npx package (the MCP server)."""
    import http.client
    import json

    # Playwright MCP listens on stdio, not HTTP. Fall back to playwright test.
    return False


def try_weasyprint(html_path: str, pdf_path: str, landscape: bool, paper_size: str) -> bool:
    """Use weasyprint library (must be preinstalled)."""
    try:
        from weasyprint import HTML as WeasyprintHTML
        from weasyprint import CSS
        # Apply page size/orientation through a CSS @page override so the
        # fallback honors the requested orientation (WeasyPrint has no
        # write_pdf() page-size argument).
        page_css = f"@page {{ size: {paper_size}{' landscape' if landscape else ''}; margin: 0.4in; }}"
        WeasyprintHTML(filename=html_path).write_pdf(
            pdf_path, stylesheets=[CSS(string=page_css)]
        )
        return os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 0
    except Exception as e:
        print(f"  WeasyPrint error: {e}")
        return False


def try_pdfkit(html_path: str, pdf_path: str, landscape: bool, paper_size: str) -> bool:
    """Use pdfkit (wkhtmltopdf wrapper; both must be preinstalled)."""
    try:
        import pdfkit
        options = {
            'page-size': paper_size,
            'margin-top': '0.4in',
            'margin-right': '0.4in',
            'margin-bottom': '0.4in',
            'margin-left': '0.4in',
            'encoding': 'UTF-8',
            'no-outline': None,
            'enable-local-file-access': None,
            'print-media-type': None,
            'no-stop-slow-scripts': None,
        }
        if landscape:
            options['orientation'] = 'Landscape'

        pdfkit.from_file(html_path, pdf_path, options=options)
        return os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 0
    except Exception as e:
        print(f"  pdfkit error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Generate PDF from HTML")
    parser.add_argument("input", help="Input HTML file")
    parser.add_argument("output", help="Output PDF file")
    parser.add_argument("--landscape", action="store_true", help="Landscape orientation")
    parser.add_argument("--paper-size", default="A4", help="Paper size (A4, Letter, etc.)")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"Error: Input file '{args.input}' not found.")
        sys.exit(1)

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

    print(f"Generating PDF from '{args.input}' -> '{args.output}'")
    print(f"  Paper: {args.paper_size}, Landscape: {args.landscape}")
    print("  Trying Playwright...")

    if try_playwright(args.input, args.output, args.landscape, args.paper_size):
        print(f"  ✓ PDF generated via Playwright")
        print(f"  Output: {os.path.abspath(args.output)} ({os.path.getsize(args.output)} bytes)")
        return

    print("  Trying WeasyPrint...")
    if try_weasyprint(args.input, args.output, args.landscape, args.paper_size):
        print(f"  ✓ PDF generated via WeasyPrint")
        return

    print("  Trying pdfkit...")
    if try_pdfkit(args.input, args.output, args.landscape, args.paper_size):
        print(f"  ✓ PDF generated via pdfkit")
        return

    print("  ✗ All PDF generation methods failed.")
    print("  Prerequisites (install once, pinned versions):")
    print("    - Playwright:  npm install -D playwright && npx playwright install chromium")
    print("    - WeasyPrint:  pip install weasyprint")
    print("    - pdfkit:      pip install pdfkit  (also needs wkhtmltopdf installed separately)")
    sys.exit(1)


if __name__ == "__main__":
    main()
