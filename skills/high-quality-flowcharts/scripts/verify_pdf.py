"""
Verify a generated PDF by creating a preview image of the first page.

Usage:
    python scripts/verify_pdf.py path/to/output.pdf

Generates path/to/output_verify.png — open it to visually check
for clipped text, overlapping elements, or broken connectors.
"""

import sys
import os


def verify_pdf(pdf_path: str) -> bool:
    if not os.path.exists(pdf_path):
        print(f"Error: File '{pdf_path}' not found.")
        return False

    # Try pdf2image first (best quality)
    try:
        from pdf2image import convert_from_path
        images = convert_from_path(pdf_path, first_page=1, last_page=1)
        if images:
            output_image = pdf_path.replace('.pdf', '_verify.png')
            images[0].save(output_image, 'PNG')
            print(f"✓ Verification image saved: {output_image}")
            print(f"  Dimensions: {images[0].width}x{images[0].height}px")
            return True
    except ImportError:
        print("  pdf2image not available, trying PIL...")
    except Exception as e:
        print(f"  pdf2image error: {e}")

    # Fallback: use PIL to render the PDF's first page. If PIL can't render
    # PDF content either, verification has NOT succeeded — a placeholder image
    # or a bare "file exists" message is not a verified preview and would hide
    # a broken PDF.
    try:
        from PIL import Image
        output_image = pdf_path.replace('.pdf', '_verify.png')
        img = Image.open(pdf_path)
        img.load()
        img.save(output_image, 'PNG')
        print(f"✓ Verification image saved: {output_image}")
        print(f"  Dimensions: {img.width}x{img.height}px")
        return True
    except Exception as e:
        print(f"  PIL could not render the PDF: {e}")
        print(f"  Install 'pdf2image' + poppler for full PDF previews.")
        print(f"  PDF file exists at: {os.path.abspath(pdf_path)} ({os.path.getsize(pdf_path)} bytes)")
        return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/verify_pdf.py <path_to_pdf>")
        sys.exit(1)
    success = verify_pdf(sys.argv[1])
    sys.exit(0 if success else 1)
