import { parseYoutubeId } from "./youtube-url";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

type Track = { baseUrl?: string; languageCode?: string; kind?: string };

type Player = {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: { title?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } };
};

function readBalanced(text: string, start: number): string | null {
  const open = text[start];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractObjectAfter(text: string, marker: string): unknown | null {
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const start = text.indexOf("{", idx + marker.length);
  if (start < 0) return null;
  const raw = readBalanced(text, start);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractPlayer(html: string): Player | null {
  const markers = [
    "var ytInitialPlayerResponse = ",
    "ytInitialPlayerResponse = ",
    "window[\"ytInitialPlayerResponse\"] = ",
  ];
  for (const marker of markers) {
    const value = extractObjectAfter(html, marker);
    if (value && typeof value === "object") return value as Player;
  }
  return null;
}

function extractInnertubeKey(html: string): string | null {
  const match = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  return match?.[1] ?? null;
}

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&#34;|&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

async function fetchTrack(url: string): Promise<string> {
  const clean = decode(url).replace(/([?&])fmt=[^&]*/g, "$1");
  const target = `${clean}${clean.includes("?") ? "&" : "?"}fmt=json3`;
  const response = await fetch(target, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/plain,*/*",
      Referer: "https://www.youtube.com/",
    },
  });
  if (!response.ok) return "";
  const body = await response.text();
  try {
    const json = JSON.parse(body) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
    return (json.events ?? [])
      .flatMap((event) => event.segs ?? [])
      .map((segment) => segment.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return body
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }
}

async function fetchTranscriptFromPlayer(
  videoId: string,
  player: Player,
): Promise<{ title: string; text: string } | null> {
  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const ordered = [
    ...tracks.filter((t) => t.languageCode === "ar" && t.kind !== "asr"),
    ...tracks.filter((t) => t.languageCode === "ar"),
    ...tracks.filter((t) => t.languageCode?.startsWith("en") && t.kind !== "asr"),
    ...tracks.filter((t) => t.languageCode?.startsWith("en")),
    ...tracks,
  ];
  const seen = new Set<string>();
  for (const track of ordered) {
    if (!track.baseUrl || seen.has(track.baseUrl)) continue;
    seen.add(track.baseUrl);
    try {
      const text = await fetchTrack(track.baseUrl);
      if (text.length >= 40) {
        return { title: player.videoDetails?.title ?? "YouTube", text };
      }
    } catch {
      // Try the next caption track.
    }
  }

  // Some current YouTube pages expose a transcript endpoint through the
  // player response rather than a directly downloadable caption track.
  // Re-querying the current player with its own dynamically supplied key keeps
  // this path aligned with the page instead of relying on an old hard-coded key.
  return null;
}

export async function fetchYoutubeTranscriptRobust(
  input: string,
): Promise<{ videoId: string; title: string; text: string }> {
  const videoId = parseYoutubeId(input);
  if (!videoId) throw new Error("youtube_invalid_url");

  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      Referer: "https://www.youtube.com/",
    },
  });

  if (!response.ok) throw new Error("youtube_fetch_failed");
  const html = await response.text();
  const player = extractPlayer(html);
  const key = extractInnertubeKey(html);

  if (player) {
    const result = await fetchTranscriptFromPlayer(videoId, player);
    if (result) return { videoId, ...result };
  }

  // Fresh WEB player request. The API key is read from the current YouTube
  // page, not hard-coded, because YouTube rotates it periodically.
  if (key) {
    try {
      const playerResponse = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(key)}&prettyPrint=false`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": UA,
            Referer: `https://www.youtube.com/watch?v=${videoId}`,
          },
          body: JSON.stringify({
            videoId,
            context: {
              client: {
                clientName: "WEB",
                clientVersion: "2.20260831.01.00",
                hl: "en",
                gl: "US",
              },
            },
          }),
        },
      );
      if (playerResponse.ok) {
        const fresh = (await playerResponse.json()) as Player;
        const result = await fetchTranscriptFromPlayer(videoId, fresh);
        if (result) return { videoId, ...result };
      }
    } catch {
      // Fall through to the existing implementation.
    }
  }

  throw new Error("youtube_no_captions");
}
