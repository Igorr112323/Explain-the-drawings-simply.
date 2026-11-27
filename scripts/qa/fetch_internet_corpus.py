#!/usr/bin/env python3
"""Download *candidate* public drawings; provenance and failures are retained for review.

Network access and licensing vary. Discovery is not evidence that a file is a drawing or that
it is appropriate for commercial use. The manifest preserves the upstream license metadata.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

USER_AGENT = 'IKGuide-QA-Crawler/1.0 (+https://github.com/Igorr112323/Explain-the-drawings-simply.) Python-urllib/3'
LIMIT = 15 * 1024 * 1024
QUERIES = ['engineering drawing', 'technical drawing', 'blueprint mechanical', 'woodworking plans', 'чертежи']
NAME = re.compile(r'draw|plan|blueprint|diagram|schem|mechanical|assembly|detail|черт|сбор|детал', re.I)
SKIP = re.compile(r'logo|icon|avatar|badge|screenshot|banner|thumbnail|gallery|photo|cover|wireframe', re.I)

class Crawler:
    def __init__(self, out: Path, maximum: int, repos: int, retries: int):
        self.out, self.maximum, self.repos, self.retries = out, maximum, repos, retries
        self.counts: dict[str, Counter] = {}
        self.errors: list[dict] = []
        self.files: list[dict] = []
        self.seen: set[str] = set()
        self.out.mkdir(parents=True, exist_ok=True)

    def request(self, url: str, accept: str = 'application/json') -> bytes:
        headers = {'User-Agent': USER_AGENT, 'Accept': accept}
        # GITHUB_TOKEN avoids anonymous throttling on Actions; never persisted in metadata.
        import os
        if urllib.parse.urlsplit(url).hostname == 'api.github.com' and os.getenv('GITHUB_TOKEN'):
            headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
        for attempt in range(self.retries + 1):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as response:
                    if int(response.headers.get('Content-Length', '0') or 0) > LIMIT * 2:
                        raise ValueError('response too large')
                    data = response.read(LIMIT * 2 + 1)
                    if len(data) > LIMIT * 2:
                        raise ValueError('response too large')
                    return data
            except Exception:
                if attempt >= self.retries:
                    raise
                time.sleep(min(8, 0.5 * (2 ** attempt)))
        raise RuntimeError('unreachable')

    def json(self, url: str):
        return json.loads(self.request(url))

    def error(self, source: str, url: str, exc: Exception):
        self.counts.setdefault(source, Counter())['errors'] += 1
        self.errors.append({'source': source, 'url': url, 'error': f'{type(exc).__name__}: {exc}'[:500]})
        print(f'{source}: {type(exc).__name__}: {exc}', file=sys.stderr, flush=True)

    def save(self, source: str, url: str, origin: str, license_: str, data: bytes, name: str):
        stats = self.counts.setdefault(source, Counter())
        if not data or len(data) > LIMIT or SKIP.search(name):
            stats['rejected'] += 1
            return
        digest = hashlib.sha256(data).hexdigest()
        if digest in self.seen:
            stats['duplicates'] += 1
            return
        try:
            if data.startswith(b'%PDF-'):
                import pymupdf
                doc = pymupdf.open(stream=data, filetype='pdf')
                if doc.page_count < 1:
                    raise ValueError('empty PDF')
                rect = doc[0].rect
                width, height = round(rect.width), round(rect.height)
                doc.close()
                ext = '.pdf'
            else:
                from PIL import Image
                with Image.open(io.BytesIO(data)) as im:
                    width, height = im.size
                    ext = {'PNG': '.png', 'JPEG': '.jpg'}.get(im.format or '', '')
                    im.verify()
                if not ext or min(width, height) < 300:
                    raise ValueError('unsupported or too small')
            path = f'{source}_{digest[:20]}{ext}'
            (self.out / path).write_bytes(data)
            self.seen.add(digest)
            self.files.append({'file': path, 'source_url': url, 'source_type': source, 'origin': origin,
                               'license': license_, 'sha256': digest, 'bytes': len(data),
                               'width': width, 'height': height, 'format': ext[1:]})
            stats['downloaded'] += 1
            print(f'{source}: {len(self.files)}/{self.maximum} {name}', flush=True)
        except Exception as exc:
            stats['rejected'] += 1
            self.error(source, url, exc)

    def github(self):
        source = 'github'
        visited: set[str] = set()
        for query in QUERIES:
            if len(self.files) >= self.maximum: break
            url = 'https://api.github.com/search/repositories?' + urllib.parse.urlencode({'q': query, 'per_page': min(30, self.repos), 'sort': 'stars'})
            try: repos = self.json(url).get('items', [])
            except Exception as exc:
                self.error(source, url, exc); continue
            for repo in repos[:self.repos]:
                if len(self.files) >= self.maximum: return
                name = repo['full_name']
                if name in visited: continue
                visited.add(name)
                treeurl = f'https://api.github.com/repos/{name}/git/trees/{urllib.parse.quote(repo["default_branch"], safe="")}?recursive=1'
                try: tree = self.json(treeurl)
                except Exception as exc:
                    self.error(source, treeurl, exc); continue
                if tree.get('truncated'): self.errors.append({'source':source,'url':treeurl,'error':'truncated tree'})
                for entry in tree.get('tree', []):
                    path = entry.get('path', '')
                    if len(self.files) >= self.maximum: return
                    if entry.get('type') != 'blob' or entry.get('size', LIMIT + 1) > LIMIT: continue
                    if not re.search(r'\.(pdf|png|jpe?g)$', path, re.I) or not NAME.search(Path(path).name) or SKIP.search(path): continue
                    self.counts.setdefault(source, Counter())['found'] += 1
                    bloburl = entry['url']
                    display = f'https://github.com/{name}/blob/{repo["default_branch"]}/{urllib.parse.quote(path)}'
                    try:
                        blob = self.json(bloburl)
                        if blob.get('encoding') != 'base64': raise ValueError('blob not base64')
                        self.save(source, display, repo['html_url'], (repo.get('license') or {}).get('spdx_id') or 'unknown', base64.b64decode(blob['content']), path)
                    except Exception as exc: self.error(source, bloburl, exc)

    def commons(self):
        source = 'commons'
        for q in QUERIES:
            if len(self.files) >= self.maximum: return
            params = {'action':'query','format':'json','generator':'search','gsrsearch':q,'gsrnamespace':6,'gsrlimit':50,
                      'prop':'imageinfo','iiprop':'url|extmetadata','iiurlwidth':0}
            url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(params)
            try:
                pages = self.json(url).get('query', {}).get('pages', {}).values()
                for p in pages:
                    if len(self.files) >= self.maximum: return
                    info = (p.get('imageinfo') or [{}])[0]; imageurl = info.get('url', '')
                    if not re.search(r'\.(pdf|png|jpe?g)$', imageurl, re.I): continue
                    self.counts.setdefault(source, Counter())['found'] += 1
                    try:
                        license_ = info.get('extmetadata', {}).get('LicenseShortName', {}).get('value', 'unknown')
                        self.save(source, imageurl, 'Wikimedia Commons', license_, self.request(imageurl, '*/*'), p.get('title', ''))
                    except Exception as exc: self.error(source, imageurl, exc)
            except Exception as exc: self.error(source, url, exc); return

    def openverse(self):
        source = 'openverse'
        for q in QUERIES:
            if len(self.files) >= self.maximum: return
            url = 'https://api.openverse.org/v1/images/?' + urllib.parse.urlencode({'q':q,'page_size':50})
            try:
                for item in self.json(url).get('results', []):
                    if len(self.files) >= self.maximum: return
                    imageurl = item.get('url', '')
                    self.counts.setdefault(source, Counter())['found'] += 1
                    try: self.save(source, imageurl, item.get('foreign_landing_url', ''), str(item.get('license', 'unknown')), self.request(imageurl, '*/*'), item.get('title', ''))
                    except Exception as exc: self.error(source, imageurl, exc)
            except Exception as exc: self.error(source, url, exc); return

    def archive(self):
        source = 'archive'
        url = 'https://archive.org/advancedsearch.php?' + urllib.parse.urlencode({'q':'title:(engineering drawing) AND mediatype:texts', 'fl[]':'identifier', 'rows':30, 'output':'json'})
        try:
            for item in self.json(url).get('response', {}).get('docs', []):
                if len(self.files) >= self.maximum: return
                ident = item['identifier']; metaurl = f'https://archive.org/metadata/{urllib.parse.quote(ident)}'
                try:
                    meta = self.json(metaurl)
                    for f in meta.get('files', []):
                        name = f.get('name', '')
                        if not name.lower().endswith('.pdf') or int(f.get('size', LIMIT + 1)) > LIMIT: continue
                        self.counts.setdefault(source, Counter())['found'] += 1
                        download = f'https://archive.org/download/{urllib.parse.quote(ident)}/{urllib.parse.quote(name)}'
                        self.save(source, download, metaurl, str(meta.get('metadata', {}).get('licenseurl', 'unknown')), self.request(download, '*/*'), name)
                        break
                except Exception as exc: self.error(source, metaurl, exc)
        except Exception as exc: self.error(source, url, exc)

    def finish(self):
        manifest = {'notice': 'Candidates, not manually verified drawings; review license before use.',
                    'sources': {k: dict(v) for k,v in self.counts.items()}, 'errors': self.errors, 'files': self.files}
        (self.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        (self.out / 'index.jsonl').write_text(''.join(json.dumps({'slug':f['file'], 'category':'internet_candidate', 'expect':{}}, ensure_ascii=False)+'\n' for f in self.files), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=Path('qa/real_corpus'))
    parser.add_argument('--max', type=int, default=500)
    parser.add_argument('--repos', type=int, default=20)
    parser.add_argument('--retries', type=int, default=2)
    args = parser.parse_args()
    crawler = Crawler(args.out, args.max, args.repos, args.retries)
    try:
        # Probe all services even if an earlier source fills the requested quota.
        crawler.commons(); crawler.openverse(); crawler.archive(); crawler.github()
    finally: crawler.finish()

if __name__ == '__main__': main()
