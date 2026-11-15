import {
  COD_CHARGE,
  TWO_PAIR_ONLINE_SHIPPING,
  TWO_PAIR_ONLINE_OUTSIDE_KERALA_EXTRA,
  ONE_PAIR_ONLINE_SHIPPING,
  ONE_PAIR_COD_SHIPPING,
  ONE_PAIR_OUTSIDE_KERALA_EXTRA,
} from "./checkout-constants";

export type OfferType = "one-pair" | "two-pair";
export type ShippingMethod = "online" | "cod";

/** True for any selected state other than Kerala. Empty state = not charged. */
export function isOutsideKerala(state: string): boolean {
  const s = (state ?? "").trim().toLowerCase();
  return s !== "" && s !== "kerala";
}

/**
 * Base shipping (Kerala price).
 *  - One pair: online 0, COD 150
 *  - Two pair: online 150, COD 300
 */
export function getBaseShipping(
  offerType: OfferType,
  shippingMethod: ShippingMethod,
): number {
  if (offerType === "one-pair") {
    return shippingMethod === "online"
      ? ONE_PAIR_ONLINE_SHIPPING
      : ONE_PAIR_COD_SHIPPING;
  }
  return shippingMethod === "online" ? TWO_PAIR_ONLINE_SHIPPING : COD_CHARGE;
}

/**
 * Extra shipping when delivering outside Kerala.
 *  - One pair: +50 (prepaid and COD)
 *  - Two pair: +100 (prepaid only), COD stays 300
 */
export function getOutsideKeralaExtra(
  offerType: OfferType,
  shippingMethod: ShippingMethod,
): number {
  if (offerType === "one-pair") return ONE_PAIR_OUTSIDE_KERALA_EXTRA;
  return shippingMethod === "online"
    ? TWO_PAIR_ONLINE_OUTSIDE_KERALA_EXTRA
    : 0;
}

export function getShippingBreakdown({
  offerType,
  shippingMethod,
  state,
}: {
  offerType: OfferType;
  shippingMethod: ShippingMethod;
  state: string;
}) {
  const base = getBaseShipping(offerType, shippingMethod);
  const outsideExtra = isOutsideKerala(state)
    ? getOutsideKeralaExtra(offerType, shippingMethod)
    : 0;
  return { base, outsideExtra, total: base + outsideExtra };
}