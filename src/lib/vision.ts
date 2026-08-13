import { ImageAnnotatorClient, protos } from "@google-cloud/vision";
import { getGoogleCredentials } from "./googleAuth";

let client: ImageAnnotatorClient | null = null;

function getClient(): ImageAnnotatorClient {
  if (!client) {
    client = new ImageAnnotatorClient({ credentials: getGoogleCredentials() });
  }
  return client;
}

type EntityAnnotation = protos.google.cloud.vision.v1.IEntityAnnotation;

interface Word {
  text: string;
  x: number;
  y: number;
  height: number;
}

const FRACTION_REGEX = /(\d{1,4})\s*\/\s*(\d{1,4})/;
// Promo cards (e.g. "SWSH001", "SM211", "XY193") print a set-prefix code
// instead of a "x/y" fraction -- no total, since they aren't part of a
// numbered set in that sense. Matched only after the fraction regex fails.
const PROMO_CODE_REGEX = /\b([A-Z]{2,6})\s?(\d{1,4})\b/;

function wordFromAnnotation(annotation: EntityAnnotation): Word {
  const vertices = annotation.boundingPoly?.vertices ?? [];
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  return {
    text: annotation.description ?? "",
    x: xs.reduce((a, b) => a + b, 0) / (xs.length || 1),
    y: ys.reduce((a, b) => a + b, 0) / (ys.length || 1),
    height: ys.length > 0 ? Math.max(...ys) - Math.min(...ys) : 0,
  };
}

/**
 * The collector number (e.g. "184/159") is always printed small in the
 * card's bottom-left corner. Scoping to that region — instead of regexing
 * the whole OCR blob — avoids picking up unrelated numbers elsewhere on the
 * card (HP, attack damage) and stray nearby words like "BASIC" that OCR
 * reading-order can jumble in next to the wrong number.
 */
function guessNumberFromBottomLeft(
  words: Word[],
  pageWidth: number,
  pageHeight: number
): { number: string; total: string | null } | null {
  if (!pageWidth || !pageHeight) return null;

  const bottomLeftWords = words
    .filter((w) => w.text && w.x < pageWidth * 0.45 && w.y > pageHeight * 0.72)
    .sort((a, b) => a.x - b.x);

  const joined = bottomLeftWords.map((w) => w.text).join(" ");

  const fractionMatch = joined.match(FRACTION_REGEX);
  if (fractionMatch) return { number: fractionMatch[1], total: fractionMatch[2] };

  const promoMatch = joined.match(PROMO_CODE_REGEX);
  if (promoMatch) return { number: `${promoMatch[1]}${promoMatch[2]}`, total: null };

  return null;
}

// Matched as substrings (not just whole-line), since some layouts —
// promo cards especially — cluster the stage badge and/or HP value onto
// the same line/height band as the name (e.g. "BASIC Grookey").
const NAME_NOISE_WORDS = /\b(basic|stage\s*\d*|mega|restored)\b/gi;

function cleanNameText(text: string): string {
  return text
    .replace(/\bHP\s*\d+\b/gi, "") // "60 HP", "HP 60", and "HP60" as one token
    .replace(/\bHP\b/gi, "") // bare "HP" when its number landed in a different line-cluster (large HP digits often do)
    .replace(NAME_NOISE_WORDS, "")
    .replace(/\b\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The Pokemon name is reliably the largest-font text in the top third of
 * the card — bigger than the small "Stage 2"/"Basic" evolution banner above
 * it and the HP label beside it. Picking "the first line of text" (as OCR
 * reading order presents it) instead grabs that banner text more often than
 * not, since it sits above the name. Font size (word bounding-box height)
 * doesn't have that failure mode, so we cluster words into lines by
 * y-position and take the line with the tallest average word height.
 */
function guessNameFromLargestTopText(words: Word[], pageWidth: number, pageHeight: number): string | null {
  if (!pageWidth || !pageHeight) return null;

  const topWords = words.filter((w) => w.text && w.height > 0 && w.y < pageHeight * 0.35);
  if (topWords.length === 0) return null;

  const sorted = [...topWords].sort((a, b) => a.y - b.y);
  const lines: Word[][] = [];
  for (const word of sorted) {
    const currentLine = lines[lines.length - 1];
    const first = currentLine?.[0];
    if (first && Math.abs(word.y - first.y) < first.height * 0.6) {
      currentLine.push(word);
    } else {
      lines.push([word]);
    }
  }

  const candidates = lines
    .map((lineWords) => {
      const text = cleanNameText(
        [...lineWords].sort((a, b) => a.x - b.x).map((w) => w.text).join(" ")
      );
      const avgHeight = lineWords.reduce((sum, w) => sum + w.height, 0) / lineWords.length;
      return { text, avgHeight };
    })
    .filter((line) => line.text.length > 1);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.avgHeight - a.avgHeight);
  return candidates[0].text;
}

/**
 * Runs OCR on a card photo and returns the raw recognized text plus best
 * guesses for the card name and collector number/set-size fraction.
 */
export async function recognizeCardText(imageBase64: string): Promise<{
  rawText: string;
  guessedNumber: string | null;
  guessedTotal: string | null;
  guessedName: string | null;
}> {
  const vision = getClient();
  const [result] = await vision.textDetection({
    image: { content: imageBase64 },
  });

  const rawText = result.fullTextAnnotation?.text ?? "";
  const page = result.fullTextAnnotation?.pages?.[0];
  // textAnnotations[0] is the full concatenated blob; the rest are individual words with geometry.
  const words = (result.textAnnotations ?? []).slice(1).map(wordFromAnnotation);
  const pageWidth = page?.width ?? 0;
  const pageHeight = page?.height ?? 0;

  const bottomLeft = guessNumberFromBottomLeft(words, pageWidth, pageHeight);
  // Fall back to a whole-text regex if we didn't get per-word geometry back
  // (e.g. an older API response shape) or nothing landed in the corner.
  const fallbackMatch = bottomLeft ? null : rawText.match(FRACTION_REGEX);

  const guessedNumber = bottomLeft?.number ?? fallbackMatch?.[1] ?? null;
  const guessedTotal = bottomLeft?.total ?? fallbackMatch?.[2] ?? null;

  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const guessedName =
    guessNameFromLargestTopText(words, pageWidth, pageHeight) ??
    // .replace() (unlike .test()) is safe to reuse across calls with a
    // global-flagged regex -- it doesn't carry lastIndex state between them.
    lines.map((line) => line.replace(NAME_NOISE_WORDS, "").trim()).find((line) => !/\d/.test(line) && line.length > 1) ??
    lines[0] ??
    null;

  return { rawText, guessedNumber, guessedTotal, guessedName };
}
