import { google } from "googleapis";
import { getGoogleCredentials } from "./googleAuth";
import type { AddCardPayload, EditableCardFields, HistoryPoint, PortfolioEntry } from "./types";

export const DEFAULT_SHEET_NAME = "Portfolio";

const HEADER_ROW = [
  "Date Added",
  "Card Name",
  "Set",
  "Number",
  "Condition",
  "Quantity",
  "Price",
  "Total Value",
  "Notes",
  "Image URL",
  "Card ID",
];

export const HISTORY_SHEET_NAME = "_History";
const HISTORY_HEADER_ROW = ["Date", "Portfolio", "Total Value", "Card Count"];

function getSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error("Missing GOOGLE_SHEET_ID env var. See README for setup.");
  }
  return id;
}

async function getSheetsClient() {
  const { client_email, private_key } = getGoogleCredentials();
  // google.auth.JWT takes `email`/`key`, not the service-account JSON's
  // native `client_email`/`private_key` field names.
  const auth = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// A1-notation ranges need the sheet/tab name single-quoted whenever it
// contains spaces or other special characters; a literal single quote in
// the name itself is escaped by doubling it.
function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

async function ensureHeaderRow(sheetName: string): Promise<void> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();
  const range = `${quoteSheetName(sheetName)}!A1:K1`;

  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range });

  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER_ROW] },
    });
  }
}

export async function appendCard(entry: AddCardPayload, sheetName: string): Promise<void> {
  await ensureHeaderRow(sheetName);
  const sheets = await getSheetsClient();

  const totalValue = entry.price * entry.quantity;
  const row = [
    new Date().toISOString().slice(0, 10),
    entry.cardName,
    entry.setName,
    entry.number,
    entry.condition,
    entry.quantity,
    entry.price,
    totalValue,
    entry.notes,
    entry.imageUrl,
    entry.cardId,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: getSheetId(),
    range: `${quoteSheetName(sheetName)}!A:K`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  await snapshotHistory(sheetName);
}

export async function listPortfolio(sheetName: string): Promise<PortfolioEntry[]> {
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: `${quoteSheetName(sheetName)}!A2:K`,
  });

  const rows = res.data.values ?? [];

  return rows
    .map((row, index) => {
      const [
        dateAdded,
        cardName,
        setName,
        number,
        condition,
        quantity,
        price,
        totalValue,
        notes,
        imageUrl,
        cardId,
      ] = row;

      if (!cardName) return null;

      return {
        rowIndex: index + 2,
        dateAdded: dateAdded ?? "",
        cardName,
        setName: setName ?? "",
        number: number ?? "",
        condition: condition ?? "",
        quantity: Number(quantity) || 0,
        price: Number(price) || 0,
        totalValue: Number(totalValue) || 0,
        notes: notes ?? "",
        imageUrl: imageUrl ?? "",
        cardId: cardId ?? "",
      } satisfies PortfolioEntry;
    })
    .filter((entry): entry is PortfolioEntry => entry !== null);
}

async function ensureHistorySheet(): Promise<void> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const exists = meta.data.sheets?.some((sheet) => sheet.properties?.title === HISTORY_SHEET_NAME);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: HISTORY_SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheetName(HISTORY_SHEET_NAME)}!A1:D1`,
      valueInputOption: "RAW",
      requestBody: { values: [HISTORY_HEADER_ROW] },
    });
  }
}

export async function recordHistorySnapshot(sheetName: string, totalValue: number, cardCount: number): Promise<void> {
  await ensureHistorySheet();
  const sheets = await getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: getSheetId(),
    range: `${quoteSheetName(HISTORY_SHEET_NAME)}!A:D`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[new Date().toISOString(), sheetName, totalValue, cardCount]] },
  });
}

export async function getHistory(sheetName: string): Promise<HistoryPoint[]> {
  const sheets = await getSheetsClient();

  let rows: string[][];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: getSheetId(),
      range: `${quoteSheetName(HISTORY_SHEET_NAME)}!A2:D`,
    });
    rows = (res.data.values ?? []) as string[][];
  } catch {
    // The history tab doesn't exist until the first snapshot is recorded.
    return [];
  }

  return rows
    .filter((row) => row[0] && row[1] === sheetName)
    // Snapshots are appended in whatever order mutations happen, which
    // doesn't guarantee chronological order in the sheet -- the chart
    // needs them sorted so the line reflects real time, not insertion order.
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map((row) => ({
      date: row[0],
      totalValue: Number(row[2]) || 0,
      cardCount: Number(row[3]) || 0,
    }));
}

async function snapshotHistory(sheetName: string): Promise<void> {
  const entries = await listPortfolio(sheetName);
  const totalValue = entries.reduce((sum, e) => sum + e.totalValue, 0);
  const cardCount = entries.reduce((sum, e) => sum + e.quantity, 0);
  await recordHistorySnapshot(sheetName, totalValue, cardCount);
}

export interface PriceUpdate {
  rowIndex: number;
  price: number;
  quantity: number;
}

// One values.batchUpdate call covering every changed row, rather than one
// values.update call per card -- keeps a portfolio-wide price refresh to a
// single Sheets API request regardless of how many cards it touches.
export async function bulkUpdatePrices(sheetName: string, updates: PriceUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const sheets = await getSheetsClient();

  const data = updates.map((u) => ({
    range: `${quoteSheetName(sheetName)}!G${u.rowIndex}:H${u.rowIndex}`,
    values: [[u.price, u.price * u.quantity]],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSheetId(),
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}

// Columns E-I are Condition, Quantity, Price, Total Value, Notes -- the
// editable fields, contiguous so they can be written in a single range.
export async function updateCardRow(sheetName: string, rowIndex: number, fields: EditableCardFields): Promise<void> {
  const sheets = await getSheetsClient();
  const totalValue = fields.price * fields.quantity;

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSheetId(),
    range: `${quoteSheetName(sheetName)}!E${rowIndex}:I${rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[fields.condition, fields.quantity, fields.price, totalValue, fields.notes]] },
  });

  await snapshotHistory(sheetName);
}

export async function deleteCardRow(sheetName: string, rowIndex: number): Promise<void> {
  const sheets = await getSheetsClient();
  const sheetId = await getSheetIdByTitle(sheetName);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSheetId(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowIndex - 1, endIndex: rowIndex },
          },
        },
      ],
    },
  });

  await snapshotHistory(sheetName);
}

/** Lists every portfolio tab in the spreadsheet, in left-to-right order (excludes the internal history log). */
export async function listSheetTabs(): Promise<string[]> {
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.get({
    spreadsheetId: getSheetId(),
    fields: "sheets.properties.title",
  });

  return (res.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => Boolean(title) && title !== HISTORY_SHEET_NAME);
}

async function getSheetIdByTitle(sheetName: string): Promise<number> {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: getSheetId(),
    fields: "sheets.properties",
  });

  const match = res.data.sheets?.find((sheet) => sheet.properties?.title === sheetName);
  if (match?.properties?.sheetId == null) {
    throw new Error(`Portfolio "${sheetName}" not found.`);
  }
  return match.properties.sheetId;
}

const INVALID_SHEET_NAME_CHARS = /[[\]*?/\\:]/;

export async function createSheetTab(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Portfolio name can't be empty.");
  if (trimmed.length > 100) throw new Error("Portfolio name is too long (max 100 characters).");
  if (INVALID_SHEET_NAME_CHARS.test(trimmed)) {
    throw new Error(`Portfolio name can't contain any of: [ ] * ? / \\ :`);
  }

  const existing = await listSheetTabs();
  if (existing.some((title) => title.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`A portfolio named "${trimmed}" already exists.`);
  }

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSheetId(),
    requestBody: {
      requests: [{ addSheet: { properties: { title: trimmed } } }],
    },
  });

  await ensureHeaderRow(trimmed);
}
