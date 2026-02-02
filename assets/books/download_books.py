import urllib.request
import urllib.error
from pathlib import Path

# Books to download: (Gutenberg ID, filename)
# Filename should be hyphenated lowercase, which converts to title case in Hearth
# e.g., "pride-and-prejudice.txt" -> "Pride and Prejudice"
BOOKS = [
    (1342, "pride-and-prejudice"),          # Jane Austen
    (2701, "moby-dick"),                    # Herman Melville
    (84, "frankenstein"),                   # Mary Shelley
    (76, "adventures-of-huckleberry-finn"), # Mark Twain
    (1661, "adventures-of-sherlock-holmes"), # Arthur Conan Doyle
    (1400, "great-expectations"),           # Charles Dickens
    (2600, "war-and-peace"),                # Leo Tolstoy
    (2554, "crime-and-punishment"),         # Fyodor Dostoyevsky
    (219, "heart-of-darkness"),             # Joseph Conrad
    (829, "gullivers-travels"),             # Jonathan Swift
]

# Save to same directory as this script (data/books/)
OUTPUT_DIR = Path(__file__).parent


def download_gutenberg_book(book_id: int, filename: str):
    """Download a single Gutenberg book by ID as plain UTF-8 text."""
    url = f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt"
    
    # Create a request with a User-Agent header (some servers require this)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Python-urllib/3.x"}
    )
    
    # Download the book content
    with urllib.request.urlopen(request) as response:
        content = response.read().decode("utf-8")
    
    # Save as plain text file
    output_path = OUTPUT_DIR / f"{filename}.txt"
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)
    
    print(f"Downloaded: {filename}.txt")
    return output_path


def download_all_books():
    """Download all books from the list."""
    for book_id, filename in BOOKS:
        try:
            download_gutenberg_book(book_id, filename)
        except Exception as e:
            print(f"Failed to download {filename}: {e}")


if __name__ == "__main__":
    print(f"Downloading {len(BOOKS)} classic books from Project Gutenberg...")
    print(f"Saving to: {OUTPUT_DIR}\n")
    download_all_books()
    print("\nDone!")
