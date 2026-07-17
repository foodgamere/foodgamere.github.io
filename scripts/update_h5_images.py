#!/usr/bin/env python3
"""Sync image.css and image assets from https://h5.baochaojianghu.com/.

Default behavior:
1. Fetch homepage and discover the current `css/image.css?...` URL.
2. Download remote CSS and rewrite CSS image URLs from `/images/...`
   to local `/css/images/...`.
3. Download all CSS-referenced images into `css/images/`.
4. Optionally download page-level assets such as `./images/saltFish.png`
   into a local `images/` directory.

Examples:
    python3 scripts/update_h5_images.py
    python3 scripts/update_h5_images.py --dry-run
    python3 scripts/update_h5_images.py --skip-page-assets
"""

from __future__ import annotations

import argparse
import hashlib
import os
import posixpath
import re
import ssl
import sys
import tempfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

try:
    import certifi
except ImportError:  # pragma: no cover
    certifi = None


DEFAULT_BASE_URL = "https://h5.baochaojianghu.com/"
DEFAULT_TIMEOUT = 30
USER_AGENT = "Mozilla/5.0 (compatible; foodgame-local-image-sync/1.0)"


def build_ssl_context() -> ssl.SSLContext:
    if certifi is not None:
        return ssl.create_default_context(cafile=certifi.where())
    return ssl.create_default_context()


def fetch_bytes(url: str, timeout: int) -> tuple[bytes, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=timeout, context=build_ssl_context()) as response:
        content_type = response.headers.get("Content-Type", "")
        return response.read(), content_type


def fetch_text(url: str, timeout: int) -> str:
    data, _ = fetch_bytes(url, timeout=timeout)
    return data.decode("utf-8", errors="replace")


class AssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = dict(attrs)
        for key in ("href", "src"):
            value = attr_map.get(key)
            if value:
                self.links.append(value)


@dataclass(frozen=True)
class DownloadJob:
    remote_url: str
    local_path: Path


def discover_home_assets(base_url: str, timeout: int) -> tuple[str, list[str]]:
    html = fetch_text(base_url, timeout)
    parser = AssetParser()
    parser.feed(html)

    css_url = None
    page_assets: list[str] = []
    for link in parser.links:
        absolute = urljoin(base_url, link)
        parsed = urlparse(absolute)
        if not parsed.scheme.startswith("http"):
            continue

        path_lower = parsed.path.lower()
        if path_lower.endswith("/css/image.css") or path_lower.endswith("css/image.css"):
            css_url = absolute
        elif "/images/" in path_lower or path_lower.startswith("/images/"):
            page_assets.append(absolute)

    if not css_url:
        raise RuntimeError("Could not discover remote image.css from homepage.")

    return css_url, sorted(set(page_assets))


def extract_css_asset_urls(css_text: str, css_url: str) -> list[str]:
    raw_urls = re.findall(r"url\(([^)]+)\)", css_text)
    results: list[str] = []
    for raw in raw_urls:
        cleaned = raw.strip().strip("'\"")
        if not cleaned or cleaned.startswith("data:"):
            continue
        results.append(urljoin(css_url, cleaned))
    return sorted(set(results))


def build_local_css_path(remote_asset_url: str, css_images_dir: Path) -> Path:
    parsed = urlparse(remote_asset_url)
    path = parsed.path
    if "/images/" in path:
        relative = path.split("/images/", 1)[1]
    else:
        relative = posixpath.basename(path)
    return css_images_dir / Path(relative)


def build_local_page_asset_path(remote_asset_url: str, page_images_dir: Path) -> Path:
    parsed = urlparse(remote_asset_url)
    path = parsed.path
    if "/images/" in path:
        relative = path.split("/images/", 1)[1]
    else:
        relative = posixpath.basename(path)
    return page_images_dir / Path(relative)


def rewrite_css_urls(css_text: str, css_url: str) -> str:
    def repl(match: re.Match[str]) -> str:
        raw = match.group(1)
        cleaned = raw.strip().strip("'\"")
        if not cleaned or cleaned.startswith("data:"):
            return match.group(0)

        absolute = urljoin(css_url, cleaned)
        parsed = urlparse(absolute)
        path = parsed.path
        if "/images/" in path:
            relative = path.split("/images/", 1)[1]
            local_url = "/css/images/" + relative
            if parsed.query:
                local_url += "?" + parsed.query
            return "url('{}')".format(local_url)
        return match.group(0)

    return re.sub(r"url\(([^)]+)\)", repl, css_text)


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_file(path: Path, data: bytes) -> bool:
    ensure_parent(path)
    if path.exists() and path.read_bytes() == data:
        return False

    with tempfile.NamedTemporaryFile(dir=str(path.parent), delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    os.replace(tmp_path, path)
    return True


def download_jobs(jobs: Iterable[DownloadJob], timeout: int, dry_run: bool) -> tuple[int, int]:
    downloaded = 0
    skipped = 0

    for job in jobs:
        try:
            data, content_type = fetch_bytes(job.remote_url, timeout)
        except (HTTPError, URLError) as exc:
            raise RuntimeError(f"Failed to download {job.remote_url}: {exc}") from exc

        if job.local_path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
            if "image/" not in content_type and "application/octet-stream" not in content_type:
                raise RuntimeError(
                    f"Unexpected content type for image asset {job.remote_url}: {content_type or 'unknown'}"
                )

        if dry_run:
            status = "update" if not job.local_path.exists() or sha256_bytes(job.local_path.read_bytes()) != sha256_bytes(data) else "skip"
            print(f"[dry-run] {status}: {job.local_path} <- {job.remote_url}")
            if status == "update":
                downloaded += 1
            else:
                skipped += 1
            continue

        changed = write_file(job.local_path, data)
        if changed:
            print(f"updated: {job.local_path}")
            downloaded += 1
        else:
            skipped += 1

    return downloaded, skipped


def prune_managed_files(root_dir: Path, keep_files: Iterable[Path], dry_run: bool) -> int:
    if not root_dir.exists():
        return 0

    keep_rel_paths = {path.relative_to(root_dir) for path in keep_files}
    removed = 0

    for path in sorted(root_dir.rglob("*")):
        if not path.is_file() or path.name == ".DS_Store":
            continue
        rel_path = path.relative_to(root_dir)
        if rel_path in keep_rel_paths:
            continue

        if dry_run:
            print(f"[dry-run] remove: {path}")
        else:
            path.unlink()
            print(f"removed: {path}")
        removed += 1

    return removed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync remote h5 image.css and image assets into this project.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Remote site root URL.")
    parser.add_argument("--css-out", default="css/image.css", help="Local image.css output path.")
    parser.add_argument("--css-image-dir", default="css/images", help="Local directory for CSS sprite images.")
    parser.add_argument("--page-image-dir", default="images", help="Local directory for page-level /images assets.")
    parser.add_argument("--skip-page-assets", action="store_true", help="Do not sync homepage /images assets.")
    parser.add_argument("--prune-css-images", action="store_true", help="Remove local CSS images that are no longer referenced remotely.")
    parser.add_argument("--dry-run", action="store_true", help="Preview downloads without writing files.")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="HTTP timeout in seconds.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    project_root = Path.cwd()
    css_out = project_root / args.css_out
    css_images_dir = project_root / args.css_image_dir
    page_images_dir = project_root / args.page_image_dir

    print(f"Discovering assets from {args.base_url}")
    css_url, page_assets = discover_home_assets(args.base_url, args.timeout)
    print(f"Remote CSS: {css_url}")

    remote_css = fetch_text(css_url, args.timeout)
    rewritten_css = rewrite_css_urls(remote_css, css_url)
    css_asset_urls = extract_css_asset_urls(remote_css, css_url)

    css_jobs = [
        DownloadJob(remote_url=url, local_path=build_local_css_path(url, css_images_dir))
        for url in css_asset_urls
    ]

    page_jobs: list[DownloadJob] = []
    if not args.skip_page_assets:
        page_jobs = [
            DownloadJob(remote_url=url, local_path=build_local_page_asset_path(url, page_images_dir))
            for url in page_assets
        ]

    print(f"CSS image assets: {len(css_jobs)}")
    if not args.skip_page_assets:
        print(f"Page image assets: {len(page_jobs)}")

    css_downloaded, css_skipped = download_jobs(css_jobs, args.timeout, args.dry_run)
    page_downloaded, page_skipped = download_jobs(page_jobs, args.timeout, args.dry_run)
    css_removed = 0
    if args.prune_css_images:
        css_removed = prune_managed_files(css_images_dir, (job.local_path for job in css_jobs), args.dry_run)

    css_bytes = rewritten_css.encode("utf-8")
    if args.dry_run:
        if not css_out.exists() or css_out.read_bytes() != css_bytes:
            print(f"[dry-run] update: {css_out} <- {css_url}")
        else:
            print(f"[dry-run] skip: {css_out}")
    else:
        changed = write_file(css_out, css_bytes)
        print(("updated" if changed else "unchanged") + f": {css_out}")

    print(
        "done: css images updated={}, skipped={}, removed={}; page images updated={}, skipped={}".format(
            css_downloaded, css_skipped, css_removed, page_downloaded, page_skipped
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
