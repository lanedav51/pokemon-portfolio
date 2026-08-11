export interface CardSearchResult {
  id: string;
  name: string;
  setName: string;
  setSeries: string;
  number: string;
  printedTotal: number | null;
  imageSmall: string;
  imageLarge: string;
  rarity: string | null;
  marketPrice: number | null;
  priceSource: "tcgplayer" | "cardmarket" | null;
}

export type CardCondition =
  | "Mint"
  | "Near Mint"
  | "Lightly Played"
  | "Moderately Played"
  | "Heavily Played"
  | "Damaged";

export interface PortfolioEntry {
  rowIndex: number;
  dateAdded: string;
  cardName: string;
  setName: string;
  number: string;
  condition: CardCondition | string;
  quantity: number;
  price: number;
  totalValue: number;
  notes: string;
  imageUrl: string;
  cardId: string;
}

export interface AddCardPayload {
  cardId: string;
  cardName: string;
  setName: string;
  number: string;
  condition: CardCondition;
  quantity: number;
  price: number;
  notes: string;
  imageUrl: string;
}
