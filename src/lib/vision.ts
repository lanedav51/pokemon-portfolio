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

const FRACTION_REGEX = /(\d{1,4})\s*\/\s*(\d{1,4})/;

function boxCenter(annotation: EntityAnnotation): { x: number; y: number } {
  const vertices = annotation.boundingPoly?.vertices ?? [];
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  return {
    x: xs.reduce((a, b) => a + b, 0) / (xs.length || 1),
    y: ys.reduce((a, b) => a + b, 0) / (ys.length || 1),
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
  words: EntityAnnotation[],
  pageWidth: number,
  pageHeight: number
): { number: string; total: string } | null {
  if (!pageWidth || !pageHeight) return null;

  const bottomLeftWords = words
    .map((w) => ({ text: w.description ?? "", ...boxCenter(w) }))
    .filter((w) => w.text && w.x < pageWidth * 0.45 && w.y > pageHeight * 0.72)
    .sort((a, b) => a.x - b.x);

  const joined = bottomLeftWords.map((w) => w.text).join(" ");
  const match = joined.match(FRACTION_REGEX);
  return match ? { number: match[1], total: match[2] } : null;
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
  const words = (result.textAnnotations ?? []).slice(1);

  const bottomLeft = page ? guessNumberFromBottomLeft(words, page.width ?? 0, page.height ?? 0) : null;

  // Fall back to a whole-text regex if we didn't get per-word geometry back
  // (e.g. an older API response shape) or nothing landed in the corner.
  const fallbackMatch = bottomLeft ? null : rawText.match(FRACTION_REGEX);

  const guessedNumber = bottomLeft?.number ?? fallbackMatch?.[1] ?? null;
  const guessedTotal = bottomLeft?.total ?? fallbackMatch?.[2] ?? null;

  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // The card name is almost always the first non-empty OCR line on a real
  // photo (top of the card), and rarely contains digits or a slash.
  const guessedName = lines.find((line) => !/\d/.test(line) && line.length > 1) ?? lines[0] ?? null;

  return { rawText, guessedNumber, guessedTotal, guessedName };
}
