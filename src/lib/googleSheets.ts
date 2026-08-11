import { google } from "googleapis";
import { getGoogleCredentials } from "./googleAuth";
import type { AddCardPayload, PortfolioEntry } from "./types";

const SHEET_NAME = "Portfolio";
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

async function ensureHeaderRow(): Promise<void> {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSheetId();

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:K1`,
  });

  if (!existing.data.values || existing.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:K1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADER_ROW] },
    });
  }
}

export async function appendCard(entry: AddCardPayload): Promise<void> {
  await ensureHeaderRow();
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
    range: `${SHEET_NAME}!A:K`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

export async function listPortfolio(): Promise<PortfolioEntry[]> {
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: `${SHEET_NAME}!A2:K`,
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
