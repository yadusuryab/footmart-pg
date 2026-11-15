import { NextRequest, NextResponse } from "next/server";
import Razorpay from "razorpay";
import { serverClient } from "@/lib/sanity-server";
import { priceCart, generateOrderId } from "@/lib/checkout-pricing";
import { validateCustomer } from "@/lib/checkout-validation";
import { INDIAN_STATES } from "@/lib/indian-states";
import { FLAME_SOCKS_PRICE } from "@/lib/checkout-constants";

export const runtime = "nodejs";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

type SanityCustomAddon = { _key: string; title: string; price: number };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      lines,
      customerDetails,
      shippingMethod,
      addShoeCleaner,
      addFlameSocks,
    } = body ?? {};

    // Anything other than "one-pair" is treated as two pair (original behavior)
    const offerType = body?.offerType === "one-pair" ? "one-pair" : "two-pair";
    const isOnePair = offerType === "one-pair";

    // Random surprise pair: decided by the offer, never by the client flag.
    // Every two pair order gets one.
    const hasRandomPair = !isOnePair;
    const randomPairSize = hasRandomPair
      ? String(body?.randomPairSize ?? "").trim().slice(0, 10)
      : "";

    // ---- 1. Validate inputs ----
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    // One pair offer: exactly one paid line, never a free item
    if (isOnePair && (lines.length !== 1 || lines[0]?.isFreeItem)) {
      return NextResponse.json(
        { error: "Invalid one pair order" },
        { status: 400 },
      );
    }

    // Two pair offer: the surprise pair needs a size so we can pack it
    if (hasRandomPair && !randomPairSize) {
      return NextResponse.json(
        { error: "Select a size for your random pair" },
        { status: 400 },
      );
    }

    if (shippingMethod !== "online" && shippingMethod !== "cod") {
      return NextResponse.json(
        { error: "Invalid shipping method" },
        { status: 400 },
      );
    }
    const custErrors = validateCustomer(customerDetails ?? {});
    if (custErrors.length) {
      return NextResponse.json(
        { error: "Invalid customer details", details: custErrors },
        { status: 400 },
      );
    }

    // State drives the outside-Kerala shipping charge, so it must be a real state
    const state = String(customerDetails?.state ?? "").trim();
    if (!INDIAN_STATES.includes(state)) {
      return NextResponse.json({ error: "Select a valid state" }, { status: 400 });
    }

    // ---- 2. Re-price server-side ----
    const priced = await priceCart(serverClient, lines, {
      shippingMethod,
      addShoeCleaner: !!addShoeCleaner,
      offerType,
      state,
    } as Parameters<typeof priceCart>[2] & {
      offerType: typeof offerType;
      state: string;
    });

    // ---- 2a. Flame socks: only if the offer is switched on in Sanity ----
    let flameSocks = false;
    if (addFlameSocks) {
      const settings = await serverClient.fetch(
        `*[_type == "settings"][0]{ freeSocksOffer }`,
      );
      if (!settings?.freeSocksOffer) {
        return NextResponse.json(
          { error: "Flame socks are no longer available. Please review your order." },
          { status: 400 },
        );
      }
      flameSocks = true;
    }
    const flameSocksTotal = flameSocks ? FLAME_SOCKS_PRICE : 0;

    // ---- 2b. Custom add-ons: title + price always come from Sanity ----
    const requestedKeys: string[] = Array.isArray(body?.customAddonKeys)
      ? Array.from(
          new Set(
            body.customAddonKeys.filter(
              (k: unknown): k is string => typeof k === "string" && !!k,
            ),
          ),
        )
      : [];

    let customAddons: SanityCustomAddon[] = [];
    if (requestedKeys.length > 0) {
      const found: SanityCustomAddon[] =
        (await serverClient.fetch(
          `*[_type == "settings"][0].customAddons[isActive != false && _key in $keys]{ _key, title, price }`,
          { keys: requestedKeys },
        )) ?? [];

      if (found.length !== requestedKeys.length) {
        return NextResponse.json(
          { error: "An add-on is no longer available. Please review your order." },
          { status: 400 },
        );
      }
      customAddons = found.map((a) => ({
        _key: a._key,
        title: a.title,
        price: Math.max(0, Number(a.price) || 0),
      }));
    }

    const customAddonsTotal = customAddons.reduce((s, a) => s + a.price, 0);

    // Add-ons raise the total. Prepaid pays it now; COD pays it on delivery
    // (COD advance stays as priced).
    const addonsTotal = customAddonsTotal + flameSocksTotal;
    const totalAmount = priced.totalAmount + addonsTotal;
    const paymentAmount = priced.isCod
      ? priced.paymentAmount
      : priced.paymentAmount + addonsTotal;
    const remainingAmount = priced.isCod
      ? priced.remainingAmount + addonsTotal
      : priced.remainingAmount;

    // ---- 3. Create Sanity order (payment pending) ----
    const orderId = generateOrderId();
    const sanityDoc = {
      _type: "order",
      orderId,
      offerType, // saved so you can see which offer the order used
      items: priced.items.map((it) => ({
        _key: it.productId + it.size,
        _type: "orderItem",
        productId: it.productId,
        productName: it.productName,
        imageUrl: it.imageUrl,
        size: it.size,
        price: it.price,
        isFreeItem: it.isFreeItem,
      })),
      // Random surprise pair (we pick the style at packing)
      hasRandomPair,
      randomPairSize: hasRandomPair ? randomPairSize : "",
      customerName: customerDetails.name,
      instagramId: customerDetails.instagramId || "",
      contact1: customerDetails.contact1,
      contact2: customerDetails.contact2 || "",
      address: customerDetails.address,
      district: customerDetails.district,
      state,
      pincode: customerDetails.pincode,
      landmark: customerDetails.landmark || "",
      shippingMethod,
      shoeCleanerAddon: !!addShoeCleaner,
      flameSocksAddon: flameSocks,
      flameSocksPrice: flameSocksTotal,
      customAddons: customAddons.map((a) => ({
        _key: a._key,
        _type: "orderCustomAddon",
        title: a.title,
        price: a.price,
      })),
      subtotal: priced.subtotal,
      shippingCharge: priced.shippingCharge,
      totalAmount,
      expectedDeliveryLabel: body.expectedDeliveryLabel || "",
      paymentStatus: "pending",
      fulfillmentStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    const created = await serverClient.create(sanityDoc);

    // ---- 4. Create Razorpay order ----
    const rzpOrder = await razorpay.orders.create({
      amount: paymentAmount * 100,
      currency: "INR",
      receipt: orderId,
      notes: {
        sanityOrderId: created._id,
        sanityOrderId_human: orderId,
        offerType,
        isCod: String(priced.isCod),
        remainingAmount: String(remainingAmount),
      },
    });

    // ---- 5. Save Razorpay order id on Sanity order ----
    await serverClient
      .patch(created._id)
      .set({ razorpayOrderId: rzpOrder.id })
      .commit();

    return NextResponse.json({
      orderId: created._id,
      humanOrderId: orderId,
      razorpayOrder: {
        id: rzpOrder.id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
      },
      // returned for display only — never trust these on later requests
      paymentAmount,
      totalAmount,
      remainingAmount,
    });
  } catch (e: any) {
    console.error("[checkout/create-order]", e);
    return NextResponse.json(
      { error: e.message || "Could not create order" },
      { status: 500 },
    );
  }
}