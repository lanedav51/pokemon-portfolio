import { google } from "googleapis";
import { getGoogleCredentials } from "./googleAuth";
import type { AddCardPayload, PortfolioEntry } from "./types";

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

/** Lists every tab in the spreadsheet, in left-to-right order — each tab is a separate portfolio. */
export async function listSheetTabs(): Promise<string[]> {
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.get({
    spreadsheetId: getSheetId(),
    fields: "sheets.properties.title",
  });

  return (res.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => Boolean(title));
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
