"""
Парсер сайта: загружает страницу, извлекает текстовый контент (заголовки, параграфы, мета),
переводит с русского на словенский через OpenAI и возвращает результат.
"""

import json
import os
import re
import urllib.request
import urllib.error
from html.parser import HTMLParser


OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
}


# ── HTML Parser ──────────────────────────────────────────────────────────────

class TextExtractor(HTMLParser):
    SKIP_TAGS = {"script", "style", "noscript", "head", "meta", "link", "svg", "img"}
    BLOCK_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th",
                  "title", "figcaption", "blockquote", "button", "a", "span", "div"}

    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self._current_tag = None
        self.blocks: list[dict] = []
        self._buf = ""
        self._buf_tag = None

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP_TAGS:
            self._skip_depth += 1
        if self._skip_depth == 0 and tag in self.BLOCK_TAGS:
            self._flush()
            self._buf_tag = tag

    def handle_endtag(self, tag):
        if tag in self.SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        if tag == self._buf_tag:
            self._flush()

    def handle_data(self, data):
        if self._skip_depth == 0:
            self._buf += data

    def _flush(self):
        text = re.sub(r"\s+", " ", self._buf).strip()
        if text and len(text) > 2:
            self.blocks.append({"tag": self._buf_tag or "text", "text": text})
        self._buf = ""
        self._buf_tag = None


def fetch_page(url: str) -> tuple[str, str]:
    """Загружает страницу, возвращает (html, final_url)."""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; SiteParser/2.4)"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace"), resp.url


def extract_texts(html: str) -> list[dict]:
    parser = TextExtractor()
    parser.feed(html)
    seen = set()
    unique = []
    for b in parser.blocks:
        if b["text"] not in seen:
            seen.add(b["text"])
            unique.append(b)
    return unique[:120]  # лимит на перевод


def translate_batch(texts: list[str], source_lang: str, target_lang: str) -> list[str]:
    """Переводит список строк через OpenAI gpt-4o-mini."""
    if not OPENAI_API_KEY:
        return [f"[no key] {t}" for t in texts]

    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
    prompt = (
        f"Переведи следующие строки с {source_lang} на {target_lang}. "
        "Верни ТОЛЬКО пронумерованный список в том же формате, без пояснений.\n\n"
        + numbered
    )

    payload = json.dumps({
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }).encode()

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())

    raw = data["choices"][0]["message"]["content"]
    lines = raw.strip().split("\n")
    result = []
    for line in lines:
        line = line.strip()
        m = re.match(r"^\d+\.\s*(.+)$", line)
        result.append(m.group(1) if m else line)

    # fallback если что-то не совпало
    while len(result) < len(texts):
        result.append(texts[len(result)])
    return result[:len(texts)]


# ── Handler ───────────────────────────────────────────────────────────────────

def handler(event: dict, context) -> dict:
    """
    Парсит страницу сайта и переводит тексты.
    POST body: { "url": "ex-sound.ru", "source_lang": "ru", "target_lang": "sl", "translate": true }
    """
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    body = {}
    if event.get("body"):
        body = json.loads(event["body"])

    url = body.get("url", "").strip()
    source_lang = body.get("source_lang", "русского")
    target_lang = body.get("target_lang", "словенский")
    do_translate = body.get("translate", True)

    if not url:
        return {
            "statusCode": 400,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": "url is required"}),
        }

    logs = []

    try:
        logs.append({"level": "info", "msg": f"Подключение к {url}..."})
        html, final_url = fetch_page(url)
        logs.append({"level": "ok", "msg": f"HTTP 200 OK — загружено {len(html)//1024} KB ({final_url})"})

        blocks = extract_texts(html)
        logs.append({"level": "ok", "msg": f"Извлечено {len(blocks)} текстовых блоков"})

        # Bitrix detection
        bitrix_components = re.findall(r'bitrix:[\w.]+', html)
        bitrix_unique = list(dict.fromkeys(bitrix_components))
        if bitrix_unique:
            logs.append({"level": "bitrix", "msg": f"[Bitrix] Найдено компонентов: {len(bitrix_unique)}"})
            for c in bitrix_unique[:6]:
                logs.append({"level": "bitrix", "msg": f"[Bitrix] {c}"})

        # Meta info
        title_m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
        desc_m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', html, re.I)
        meta = {
            "title": title_m.group(1).strip() if title_m else "",
            "description": desc_m.group(1).strip() if desc_m else "",
        }

        # Links
        url_parts = url.split("/")
        domain = url_parts[2] if len(url_parts) > 2 else url
        links = re.findall(r'href=["\']([^"\'#?]+)["\']', html)
        links = [l for l in links if l.startswith("/") or domain in l]
        links_unique = list(dict.fromkeys(links))[:50]
        logs.append({"level": "info", "msg": f"Найдено ссылок: {len(links_unique)}"})

        translated_blocks = []
        if do_translate and blocks:
            if not OPENAI_API_KEY:
                logs.append({"level": "warn", "msg": "OPENAI_API_KEY не задан — перевод пропущен"})
                translated_blocks = [{"tag": b["tag"], "original": b["text"], "translated": b["text"]} for b in blocks]
            else:
                logs.append({"level": "info", "msg": f"Перевод {len(blocks)} блоков ({source_lang} → {target_lang})..."})
                chunk_size = 30
                all_translated: list[str] = []
                for i in range(0, len(blocks), chunk_size):
                    chunk = blocks[i:i+chunk_size]
                    translated = translate_batch([b["text"] for b in chunk], source_lang, target_lang)
                    all_translated.extend(translated)
                    logs.append({"level": "ok", "msg": f"Переведено блоков: {min(i+chunk_size, len(blocks))}/{len(blocks)}"})

                translated_blocks = [
                    {"tag": b["tag"], "original": b["text"], "translated": t}
                    for b, t in zip(blocks, all_translated)
                ]
                logs.append({"level": "ok", "msg": "Перевод завершён"})
        else:
            translated_blocks = [{"tag": b["tag"], "original": b["text"], "translated": ""} for b in blocks]

        logs.append({"level": "ok", "msg": f"Парсинг завершён. Блоков: {len(translated_blocks)}, ссылок: {len(links_unique)}"})

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({
                "url": final_url,
                "meta": meta,
                "blocks": translated_blocks,
                "links": links_unique,
                "bitrix_components": bitrix_unique,
                "stats": {
                    "total_blocks": len(translated_blocks),
                    "total_links": len(links_unique),
                    "bitrix_count": len(bitrix_unique),
                    "html_size_kb": len(html) // 1024,
                },
                "logs": logs,
            }, ensure_ascii=False),
        }

    except urllib.error.HTTPError as e:
        logs.append({"level": "error", "msg": f"HTTP {e.code}: {e.reason}"})
        return {"statusCode": 200, "headers": CORS_HEADERS,
                "body": json.dumps({"error": f"HTTP {e.code}", "logs": logs}, ensure_ascii=False)}
    except Exception as e:
        logs.append({"level": "error", "msg": f"Ошибка: {str(e)}"})
        return {"statusCode": 200, "headers": CORS_HEADERS,
                "body": json.dumps({"error": str(e), "logs": logs}, ensure_ascii=False)}