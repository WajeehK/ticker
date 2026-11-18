#!/usr/bin/env python3
"""Pre-fetch readable article text for news.json into data/news_text/.

Frontline-style: keep the RSS summary, unwrap Google News to the publisher URL
when the feed includes it, then extract the first available paragraphs from
the publisher page. Jina is used only as a limited fallback.
"""
from __future__ import annotations

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
sys.path.insert(0, str(ROOT / "pipeline"))
from market_extras import (  # noqa: E402
    FEEDS, NEWS_CORE, QUERIES, _open, _parse_rss, write_market  # write_market unused
)

UA = "TickerPWA/1.2 (https://wajeehk.github.io/ticker/; article-reader)"

import ssl
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

CTX = ssl.create_default_context()
BATCHEXECUTE_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
_SG = re.compile(r'data-n-a-sg="([^"]+)"')
_TS = re.compile(r'data-n-a-ts="([^"]+)"')
_GARTURLREQ_CTX = [
    ["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None, None, None, 0, 1],
    "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0,
]

def _http(url: str, data: bytes | None = None, timeout: int = 12, headers: dict | None = None) -> str | None:
    hdrs = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        hdrs.update(headers)
    try:
        req = Request(url, data=data, headers=hdrs)
        with urlopen(req, timeout=timeout, context=CTX) as r:
            if getattr(r, "status", 200) >= 400:
                return None
            return r.read().decode("utf-8", "replace")
    except Exception:
        return None

def google_article_id(url: str) -> str | None:
    try:
        u = urlparse(url)
        parts = u.path.split("/")
        if u.hostname == "news.google.com" and len(parts) > 1 and parts[-2] in ("articles", "read"):
            return parts[-1] or None
    except Exception:
        return None
    return None

def google_sig(url: str) -> tuple[str, str, str] | None:
    art = google_article_id(url)
    if not art:
        return None
    qs = parse_qs(urlparse(url).query)
    hl, gl, ceid = (qs.get("hl") or ["en-GB"])[0], (qs.get("gl") or ["GB"])[0], (qs.get("ceid") or ["GB:en"])[0]
    page = f"https://news.google.com/rss/articles/{art}?hl={quote(hl)}&gl={quote(gl)}&ceid={quote(ceid)}"
    html = _http(page, timeout=12)
    if not html:
        return None
    sg, ts = _SG.search(html), _TS.search(html)
    if not (sg and ts):
        return None
    return art, ts.group(1), sg.group(1)

def google_unwrap_many(urls: list[str], workers: int = 8) -> dict[str, str]:
    """Map Google News URL -> publisher URL."""
    unique = []
    seen = set()
    for u in urls:
        if u and u not in seen and "news.google.com" in u:
            seen.add(u); unique.append(u)
    params: dict[str, tuple[str, str, str]] = {}
    def sig_job(u):
        try:
            return u, google_sig(u)
        except Exception:
            return u, None
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(sig_job, u) for u in unique]
        done = 0
        for fut in as_completed(futs):
            u, got = fut.result()
            done += 1
            if got:
                params[u] = got
            if done % 80 == 0:
                print(f"    unwrapped signatures {done}/{len(unique)} ({len(params)} ok)", flush=True)
    print(f"    signatures {len(params)}/{len(unique)}", flush=True)
    # batchexecute in chunks
    out: dict[str, str] = {}
    items = list(params.items())
    CHUNK = 30
    for i in range(0, len(items), CHUNK):
        chunk = items[i:i+CHUNK]
        envelopes = []
        for req_id, (u, (art, ts, sg)) in enumerate(chunk):
            inner = ["garturlreq", _GARTURLREQ_CTX, art, int(ts) if str(ts).isdigit() else ts, sg]
            envelopes.append(["Fbv4je", json.dumps(inner, separators=(",", ":")), None, str(req_id)])
        body = "f.req=" + quote(json.dumps([envelopes], separators=(",", ":")))
        text = _http(
            BATCHEXECUTE_URL,
            data=body.encode(),
            timeout=20,
            headers={"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
        )
        if not text:
            continue
        if "\n\n" in text:
            text = text.split("\n\n", 1)[1]
        text = text.lstrip()
        if text.startswith(")]}'"):
            text = text.split("\n", 1)[1] if "\n" in text else text[4:]
            text = text.lstrip()
        try:
            rows = json.loads(text)
        except Exception:
            continue
        if rows and isinstance(rows[-1], list) and rows[-1] and rows[-1][0] in ("di", "e"):
            # may have both di and e at end
            while rows and isinstance(rows[-1], list) and rows[-1] and rows[-1][0] in ("di", "e"):
                rows = rows[:-1]
            # also af.httprm
        pairs = {}
        ordered = []
        for row in rows:
            if not (isinstance(row, list) and len(row) >= 3):
                continue
            if row[0] == "wrb.fr" or (len(row) > 1 and row[1] == "Fbv4je"):
                payload = row[2]
                if isinstance(payload, str):
                    try:
                        payload = json.loads(payload)
                    except Exception:
                        continue
                if isinstance(payload, list) and payload and payload[0] == "garturlres":
                    req_id = None
                    for cell in reversed(row[3:]):
                        if cell is not None:
                            req_id = str(cell); break
                    pairs[req_id] = payload[1]
                    ordered.append(payload[1])
        for req_id, (u, _) in enumerate(chunk):
            dest = pairs.get(str(req_id))
            if not dest and str(req_id) not in pairs and req_id < len(ordered):
                dest = ordered[req_id]
            if dest and dest.startswith("http"):
                out[u] = dest
        time.sleep(0.15)
    print(f"    decoded {len(out)}/{len(unique)} publisher URLs", flush=True)
    return out



def news_sid(raw: str) -> str:
    h = 0
    for ch in raw or "":
        h = (h << 5) - h + ord(ch)
        h = (h + 2**31) % 2**32 - 2**31
    n = h & 0xFFFFFFFF
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        s = "0"
    else:
        s = ""
        while n:
            s = chars[n % 36] + s
            n //= 36
    return "n" + s


def norm_title(t: str) -> str:
    t = re.sub(r"\s+", " ", (t or "").lower())
    t = re.sub(r"\s+[-–—]\s+[^-–—]{2,40}$", "", t)
    return t.strip()


def collect_news_items(news: dict) -> list[dict]:
    items = []
    for it in news.get("market") or []:
        items.append(it)
    for it in news.get("crypto") or []:
        items.append(it)
    for arr in (news.get("bySymbol") or {}).values():
        if isinstance(arr, list):
            items.extend(arr)
    seen, out = set(), []
    for it in items:
        if not it or not it.get("url") or not it.get("title"):
            continue
        if it["url"] in seen:
            continue
        seen.add(it["url"])
        out.append(it)
    return out


def harvest_rss(news: dict, ua: str) -> list[dict]:
    """Re-read the same family of feeds so we get descriptions + publisher hrefs."""
    harvested = []
    for source, url in FEEDS:
        raw = _open(url, ua, tries=2, timeout=18)
        if not raw:
            print(f"  feed miss: {source}", flush=True)
            continue
        harvested.extend(_parse_rss(raw, source, limit=40))
        time.sleep(0.15)
    # per-symbol Google News queries for symbols actually present
    symbols = []
    for s in NEWS_CORE:
        symbols.append(s)
    for s in (news.get("bySymbol") or {}):
        if s not in symbols:
            symbols.append(s)
    # cap to avoid a 15-minute stall; core + first 80 others
    symbols = symbols[:120]
    for sym in symbols:
        q = QUERIES.get(sym) or f"{sym} stock OR shares"
        url = "https://news.google.com/rss/search?" + urlencode(
            {"q": q + " when:7d", "hl": "en-GB", "gl": "GB", "ceid": "GB:en"}
        )
        raw = _open(url, ua, tries=1, timeout=15)
        if raw:
            harvested.extend(_parse_rss(raw, "Google News", limit=12))
        time.sleep(0.12)
    print(f"  harvested {len(harvested)} RSS items", flush=True)
    return harvested


def extract_from_html(html: str) -> str:
    try:
        from bs4 import BeautifulSoup
    except Exception:
        BeautifulSoup = None
    if not BeautifulSoup:
        return ""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "footer", "aside", "form", "noscript"]):
        tag.decompose()
    article = soup.find("article") or soup.find("div", attrs={"itemprop": "articleBody"}) or soup.find("main") or soup
    paras = []
    for p in article.find_all("p"):
        tx = " ".join(p.get_text(" ", strip=True).split())
        if len(tx) < 40:
            continue
        if re.search(r"cookie|subscribe|sign in|log in|advertisement|enable javascript|accept (all )?cookies", tx, re.I):
            continue
        paras.append(tx)
        if len(paras) >= 40:
            break
    return "\n\n".join(paras).strip()


def fetch_publisher(url: str, ua: str) -> str:
    if not url or "news.google.com" in url:
        return ""
    raw = _open(url, ua, tries=1, timeout=12)
    if not raw:
        return ""
    try:
        html = raw.decode("utf-8", "replace")
    except Exception:
        return ""
    return extract_from_html(html)


def prefetch_news_text(data_dir: Path | None = None, workers: int = 6) -> dict:
    data_dir = Path(data_dir or DATA)
    news_path = data_dir / "news.json"
    news = json.loads(news_path.read_text(encoding="utf-8"))
    items = collect_news_items(news)
    print(f"news_text: {len(items)} unique stories in news.json", flush=True)

    have_meta = sum(1 for it in items if it.get("canonical") or it.get("summary") or it.get("excerpt") or it.get("text"))
    if have_meta >= max(8, int(0.2 * len(items))):
        print(f"  {have_meta} stories already have a summary or publisher URL; skipping a second RSS harvest", flush=True)
        harvested = []
    else:
        harvested = harvest_rss(news, UA)
    by_url, by_title = {}, {}
    for it in harvested:
        if it.get("url"):
            by_url[it["url"]] = it
        k = norm_title(it.get("title") or "")
        if k and k not in by_title:
            by_title[k] = it

    # seed records
    recs = {}
    byUrl = {}
    pending_fetch = []
    for it in items:
        sid = news_sid(it["url"])
        rec = {
            "url": it["url"],
            "title": it.get("title"),
            "source": it.get("source"),
            "sid": sid,
            "ok": False,
            "via": "",
        }
        hit = by_url.get(it["url"]) or by_title.get(norm_title(it.get("title") or ""))
        text = (it.get("text") or "").strip()
        excerpt = (it.get("excerpt") or it.get("summary") or "").strip()
        canonical = it.get("canonical")
        if hit:
            if hit.get("canonical"):
                canonical = canonical or hit["canonical"]
            if hit.get("summary") and not excerpt:
                excerpt = hit["summary"]
            if hit.get("text") and not text:
                text = hit["text"]
            if hit.get("source") and hit["source"] != "Google News":
                rec["source"] = rec["source"] or hit["source"]
        rec["canonical"] = canonical or ""
        rec["excerpt"] = (excerpt or "")[:500]
        if len(text) >= 400:
            rec["text"] = text[:12000]
            rec["ok"] = True
            rec["via"] = "stored"
        elif excerpt and len(excerpt) >= 80:
            rec["text"] = excerpt
            rec["via"] = "rss-summary"
        recs[sid] = rec
        byUrl[it["url"]] = sid

    # Unwrap Google News URLs in batch, then queue publisher pages
    need_unwrap = [rec["url"] for rec in recs.values() if (not rec.get("ok")) and "news.google.com" in (rec.get("url") or "") and not rec.get("canonical")]
    if need_unwrap:
        print(f"  unwrapping {len(need_unwrap)} Google News links", flush=True)
        decoded = google_unwrap_many(need_unwrap)
        for rec in recs.values():
            dest = decoded.get(rec["url"])
            if dest:
                rec["canonical"] = dest

    for sid, rec in recs.items():
        target = rec.get("canonical") or rec.get("url") or ""
        if rec.get("ok"):
            continue
        if target and "news.google.com" not in target:
            pending_fetch.append((sid, target))

    print(f"  matched RSS metadata for {sum(1 for r in recs.values() if r.get('excerpt') or r.get('canonical'))} stories; "
          f"{len(pending_fetch)} publisher pages to extract", flush=True)

    def job(sid, url):
        try:
            body = fetch_publisher(url, UA)
        except Exception:
            body = ""
        return sid, body

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(job, sid, url) for sid, url in pending_fetch]
        for fut in as_completed(futs):
            sid, body = fut.result()
            done += 1
            rec = recs[sid]
            if body and len(body) >= 280:
                rec["text"] = body[:12000]
                rec["excerpt"] = rec.get("excerpt") or body[:400]
                rec["ok"] = len(body) >= 400
                rec["via"] = "publisher"
            elif body:
                if not rec.get("text"):
                    rec["text"] = body
                rec["via"] = (rec.get("via") or "") + "+publisher-short"
            if done % 40 == 0:
                full = sum(1 for r in recs.values() if len(r.get("text") or "") >= 400)
                print(f"  … {done}/{len(pending_fetch)} pages, full-text so far {full}", flush=True)

    # If we only have a strong RSS summary, treat 280+ char multi-sentence summaries as body
    for rec in recs.values():
        text = rec.get("text") or rec.get("excerpt") or ""
        if rec.get("ok"):
            continue
        if len(text) >= 280 and text.count(".") + text.count("!") + text.count("?") >= 2:
            rec["text"] = text[:12000]
            rec["ok"] = True
            rec["via"] = rec.get("via") or "rss-summary"

    # write back summaries into news.json so the client has a first paint even before index loads
    def patch(it):
        if not it or not it.get("url"):
            return
        rec = recs.get(news_sid(it["url"]))
        if not rec:
            return
        if rec.get("excerpt") and not it.get("excerpt"):
            it["excerpt"] = rec["excerpt"]
            it["summary"] = rec["excerpt"]
        if rec.get("canonical") and not it.get("canonical"):
            it["canonical"] = rec["canonical"]
        if rec.get("ok") and rec.get("text") and not it.get("text"):
            # keep news.json smaller: only store excerpt there; full text lives in news_text
            pass

    for it in news.get("market") or []:
        patch(it)
    for it in news.get("crypto") or []:
        patch(it)
    for arr in (news.get("bySymbol") or {}).values():
        if isinstance(arr, list):
            for it in arr:
                patch(it)
    news_path.write_text(json.dumps(news, separators=(",", ":")), encoding="utf-8")

    total = len(items) or 1
    full = sum(1 for r in recs.values() if r.get("ok") and len(r.get("text") or "") >= 400)
    readable = sum(1 for r in recs.values() if len(r.get("text") or r.get("excerpt") or "") >= 80)
    out = {
        "asOf": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(recs),
        "fullText": full,
        "readable": readable,
        "rate": round(100.0 * full / total, 1),
        "readableRate": round(100.0 * readable / total, 1),
        "items": recs,
        "byUrl": byUrl,
        "note": "Pre-fetched for the in-app reader from RSS summaries and publisher pages. Not every outlet allows extraction.",
    }
    dest = data_dir / "news_text"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "index.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(
        f"news_text: {full}/{total} with full body ({out['rate']}%), "
        f"{readable}/{total} readable ({out['readableRate']}%)",
        flush=True,
    )
    return out


if __name__ == "__main__":
    prefetch_news_text()
