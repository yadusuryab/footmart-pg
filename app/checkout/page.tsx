"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CustomerDetailsForm } from "@/components/checkout/checkout-form";
import { site } from "@/lib/site-config";
import { client } from "@/sanityClient";
import { fbEvent, fbTrackCustom } from "@/lib/fbq";
import {
  BASE_PRICE,
  ONE_PAIR_PRICE,
  SHOE_CLEANER_PRICE,
  ONLINE_DELIVERY_MIN_DAYS,
  ONLINE_DELIVERY_MAX_DAYS,
  COD_DELIVERY_MIN_DAYS,
  COD_DELIVERY_MAX_DAYS,
} from "@/lib/checkout-constants";
import { getShippingBreakdown } from "@/lib/checkout-shipping";
import { getCodAdvance } from "@/lib/checkout-pricing";
import { DEFAULT_STATE } from "@/lib/indian-states";
import { CartItem, CheckoutStep, CustomerDetails } from "@/lib/types/checkout";
import { getExpectedDelivery } from "@/lib/checkout-utils";

const SITE_ORIGIN = "https://shopfootmart.in";
const RAZORPAY_SRC = "https://checkout.razorpay.com/v1/checkout.js";

const REQUIRED_FIELDS = [
  "name",
  "contact1",
  "address",
  "district",
  "state",
  "pincode",
] as const;

type CustomAddon = {
  _key: string;
  title: string;
  description?: string;
  price: number;
  imageUrl?: string;
};

declare global {
  interface Window {
    Razorpay: any;
  }
}

const loadRazorpay = (): Promise<boolean> =>
  new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_SRC}"]`,
    );
    if (existing) existing.remove(); // drop stale/failed tag before retrying

    const timeout = setTimeout(() => resolve(false), 8000);
    const s = document.createElement("script");
    s.src = RAZORPAY_SRC;
    s.async = true;
    s.onload = () => {
      clearTimeout(timeout);
      resolve(!!window.Razorpay);
    };
    s.onerror = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    document.body.appendChild(s);
  });

const getProductImageUrl = (product: any): string => {
  if (!product) return "/placeholder-image.jpg";
  const url =
    product.image ||
    product.imageUrl ||
    product.images?.[0]?.asset?.url ||
    product.images?.[0]?.url ||
    "";
  if (!url) return "/placeholder-image.jpg";
  // Tiny thumbnails only: this page shows 64px images.
  if (url.includes("cloudinary.com"))
    return url.replace("/upload/", "/upload/w_160,h_160,c_fill,q_50,f_auto/");
  return url;
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : "3rd");

/* ---------- Design tokens ---------- */

const DISPLAY = "font-black italic tracking-tighter";
const H1 = `text-[clamp(2.25rem,9vw,3.5rem)] leading-[1] ${DISPLAY}`;
const CHIP = "rounded-md bg-black px-1.5 py-0.5 text-primary";
const SELECTABLE =
  "relative block cursor-pointer rounded-2xl p-4 transition-[background-color,box-shadow,transform] duration-300 active:scale-[0.99] motion-reduce:transition-none";
const FOCUS_RING =
  "pointer-events-none absolute inset-0 rounded-2xl peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-black";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const CheckIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg {...iconProps} className={className}>
    <path d="M5 12l5 5L20 7" />
  </svg>
);

const ArrowIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg {...iconProps} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const WarnIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg {...iconProps} className={className}>
    <path d="M12 3l10 18H2L12 3zM12 10v5M12 18h.01" />
  </svg>
);

const SpinnerIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg {...iconProps} className={`${className} animate-spin`}>
    <path d="M12 3a9 9 0 109 9" />
  </svg>
);

/* ---------- UI atoms ---------- */

const PILL =
  "group flex h-14 items-center justify-between rounded-full bg-black pl-6 pr-1.5 text-white transition-[transform,opacity] duration-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black motion-reduce:transition-none";

const PillContent = ({
  children,
  loading,
}: {
  children: React.ReactNode;
  loading?: boolean;
}) => (
  <>
    <span className={`text-base ${DISPLAY}`}>{children}</span>
    <span
      aria-hidden
      className="ml-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-black transition-transform duration-300 group-enabled:group-hover:translate-x-0.5 motion-reduce:transition-none"
    >
      {loading ? <SpinnerIcon /> : <ArrowIcon />}
    </span>
  </>
);

const PillCTA = ({
  children,
  onClick,
  className = "",
  disabled,
  loading,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`${PILL} ${className}`}
  >
    <PillContent loading={loading}>{children}</PillContent>
  </button>
);

const StepBar = ({ step }: { step: CheckoutStep }) => {
  const idx = step === "payment" ? 0 : 1;
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1.5" aria-hidden>
        {[0, 1].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-500 motion-reduce:transition-none ${
              i <= idx ? "bg-black" : "bg-black/10"
            }`}
          />
        ))}
      </div>
      <span className="text-xs font-bold text-muted-foreground">
        Step {idx + 1} of 2
      </span>
    </div>
  );
};

const PairRow = ({
  product,
  label,
  free,
  random,
  size,
}: {
  product?: CartItem;
  label: string;
  free?: boolean;
  random?: boolean;
  size?: string | null;
}) => (
  <div className="flex items-center gap-3 rounded-2xl bg-muted p-2.5">
    {random ? (
      <div
        aria-hidden
        className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary text-3xl text-black ${DISPLAY}`}
      >
        ?
      </div>
    ) : (
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white">
        <Image
          src={getProductImageUrl(product)}
          alt={product?.productName || "Product"}
          width={64}
          height={64}
          sizes="64px"
          quality={50}
          className="h-full w-full object-cover"
          loading="eager"
        />
      </div>
    )}
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-bold tracking-tight">
        {random ? "Random surprise pair" : product?.productName || "Product"}
      </p>
      <p className="text-xs text-muted-foreground">
        {random
          ? size
            ? `Size ${size}`
            : ""
          : `Size ${product?.selectedSize || "N/A"}`}
      </p>
    </div>
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
        free ? "bg-primary text-black" : "bg-black text-primary"
      }`}
    >
      {label}
    </span>
  </div>
);

const PayOption = ({
  id,
  checked,
  onSelect,
  title,
  tag,
  strongTag,
  children,
}: {
  id: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  tag: string;
  strongTag?: boolean;
  children: React.ReactNode;
}) => (
  <label
    htmlFor={id}
    className={`${SELECTABLE} ${
      checked
        ? "bg-primary shadow-[inset_0_0_0_2px_#000]"
        : "bg-muted hover:bg-muted/70"
    }`}
  >
    <input
      id={id}
      type="radio"
      name="payment"
      checked={checked}
      onChange={onSelect}
      className="peer sr-only"
    />
    <span className={FOCUS_RING} />
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-black transition-colors motion-reduce:transition-none ${
          checked ? "bg-black text-primary" : ""
        }`}
      >
        {checked && <CheckIcon className="h-3 w-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold tracking-tight">{title}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              strongTag ? "bg-black text-primary" : "bg-black/10 text-black"
            }`}
          >
            {tag}
          </span>
        </div>
        <div className="mt-1.5 space-y-0.5 text-xs text-black/70">
          {children}
        </div>
      </div>
    </div>
  </label>
);

const AddOn = ({
  checked,
  onToggle,
  title,
  desc,
  price,
  was,
  tag,
  imageUrl,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  desc?: string;
  price: string;
  was?: string;
  tag?: string;
  imageUrl?: string;
}) => (
  <label
    className={`${SELECTABLE} ${
      checked
        ? "bg-primary shadow-[inset_0_0_0_2px_#000]"
        : "bg-muted hover:bg-muted/70"
    }`}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={onToggle}
      className="peer sr-only"
    />
    <span className={FOCUS_RING} />
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 border-black transition-colors motion-reduce:transition-none ${
          checked ? "bg-black text-primary" : ""
        }`}
      >
        {checked && <CheckIcon className="h-3 w-3" />}
      </span>
      {imageUrl && (
        <Image
          src={imageUrl}
          alt=""
          width={48}
          height={48}
          unoptimized
          className="h-12 w-12 shrink-0 rounded-lg bg-white object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        {tag && (
          <span className="mb-1 inline-block rounded-full bg-black px-2 py-0.5 text-[11px] font-bold text-primary">
            {tag}
          </span>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold tracking-tight">{title}</span>
          <span className="flex items-center gap-1.5">
            {was && (
              <span className="text-xs text-black/50 line-through">{was}</span>
            )}
            <span className="rounded-full bg-black px-2 py-0.5 text-xs font-bold text-primary">
              {price}
            </span>
          </span>
        </div>
        {desc && <p className="mt-1 text-xs text-black/70">{desc}</p>}
      </div>
    </div>
  </label>
);

const Row = ({
  label,
  value,
  muted,
  indent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  indent?: boolean;
}) => (
  <div
    className={`flex justify-between text-sm ${indent ? "pl-4" : ""} ${
      muted ? "text-muted-foreground" : "font-medium"
    }`}
  >
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

/* ---------- Page ---------- */

export default function CheckoutPage() {
  const router = useRouter();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [shippingMethod, setShippingMethod] = useState<"online" | "cod">(
    "online",
  );
  const [addShoeCleaner, setAddShoeCleaner] = useState(false);
  const [currentStep, setCurrentStep] = useState<CheckoutStep>("payment");
  const [customerDetails, setCustomerDetails] = useState<CustomerDetails>({
    name: "",
    contact1: "",
    contact2: "",
    address: "",
    district: "",
    state: DEFAULT_STATE,
    pincode: "",
    landmark: "",
    instagramId: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [orderDate] = useState<Date>(() => new Date());
  const [showPayAlert, setShowPayAlert] = useState(false);
  const [waFallback, setWaFallback] = useState<{
    url: string;
    reason: string;
  } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const [freeSocksOffer, setFreeSocksOffer] = useState(false);
  const [shoeCleanerAddon, setShoeCleanerAddon] = useState(false);
  const [customAddons, setCustomAddons] = useState<CustomAddon[]>([]);
  const [selectedAddonKeys, setSelectedAddonKeys] = useState<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Preload Razorpay so it's usually ready before the click
  useEffect(() => {
    loadRazorpay();
  }, []);

  useEffect(() => {
    try {
      const cart = JSON.parse(localStorage.getItem("cart") || "[]");
      setCartItems(Array.isArray(cart) ? cart : []);
    } catch {
      setCartItems([]);
    }
    setCartLoaded(true);
  }, []);

  useEffect(() => {
    client
      .fetch(
        `*[_type == "settings"][0]{
          freeSocksOffer,
          shoeCleanerAddon,
          "customAddons": customAddons[isActive != false]{
            _key,
            title,
            description,
            price,
            "imageUrl": image.asset->url + "?w=200&h=200&auto=format&q=80&fit=crop"
          }
        }`,
      )
      .then((data) => {
        setFreeSocksOffer(!!data?.freeSocksOffer);
        setShoeCleanerAddon(!!data?.shoeCleanerAddon);
        setCustomAddons(
          Array.isArray(data?.customAddons) ? data.customAddons : [],
        );
      })
      .catch(() => {
        setFreeSocksOffer(false);
        setShoeCleanerAddon(false);
        setCustomAddons([]);
      })
      .finally(() => setSettingsLoaded(true));
  }, []);

  useEffect(() => {
    if (settingsLoaded && !shoeCleanerAddon && addShoeCleaner) {
      setAddShoeCleaner(false);
    }
  }, [settingsLoaded, shoeCleanerAddon, addShoeCleaner]);

  // Drop selected add-ons that were disabled or removed in Sanity
  useEffect(() => {
    if (!settingsLoaded) return;
    setSelectedAddonKeys((prev) => {
      const valid = prev.filter((k) => customAddons.some((a) => a._key === k));
      return valid.length === prev.length ? prev : valid;
    });
  }, [settingsLoaded, customAddons]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentStep]);

  useEffect(() => {
    if (formErrors.length) {
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [formErrors]);

  // Warn before closing/refreshing the tab while a payment is in progress
  useEffect(() => {
    if (!isLoading) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isLoading]);

  const toggleCustomAddon = (key: string) => {
    setSelectedAddonKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  /* ----- Pairs ----- */

  const mainProduct = cartItems[0];

  // Offer type set by useAddToCart. Missing/unknown = two pair (original).
  const offerType: "one-pair" | "two-pair" =
    mainProduct?.offerType === "one-pair" ? "one-pair" : "two-pair";
  const isOnePair = offerType === "one-pair";

  // Second chosen pair (free) only exists in the two pair offer
  const freeProduct = isOnePair ? undefined : mainProduct?.freeProduct;
  const hasFreePair =
    !isOnePair && !!mainProduct?.buyOneGetOne && !!freeProduct;

  // Random surprise pair: every two pair order gets one.
  //   with chosen free pair -> pair 3 is random
  //   without               -> pair 2 is random
  const hasRandomPair = !isOnePair;
  const randomPairNo = hasFreePair ? 3 : 2;
  const pairCount = 1 + (hasFreePair ? 1 : 0) + (hasRandomPair ? 1 : 0);
  // Picked in the add-to-cart flow; this page only displays/sends it.
  const randomPairSize =
    (mainProduct as (CartItem & { randomPairSize?: string | null }) | undefined)
      ?.randomPairSize || null;

  /* ----- Money (display only; server recomputes) ----- */

  const offerBasePrice = isOnePair ? ONE_PAIR_PRICE : BASE_PRICE;
  const pair1Extra = isOnePair
    ? 0
    : Math.max(0, (mainProduct?.price || BASE_PRICE) - BASE_PRICE);
  const pair2Extra = isOnePair
    ? 0
    : Math.max(0, (freeProduct?.price || BASE_PRICE) - BASE_PRICE);
  const subtotal = offerBasePrice + pair1Extra + pair2Extra;

  const shipping = getShippingBreakdown({
    offerType,
    shippingMethod,
    state: customerDetails.state,
  });
  const shippingCharge = shipping.total;
  const outsideKeralaExtra = shipping.outsideExtra;

  const prepaidSavings = Math.max(
    0,
    getShippingBreakdown({
      offerType,
      shippingMethod: "cod",
      state: customerDetails.state,
    }).total -
      getShippingBreakdown({
        offerType,
        shippingMethod: "online",
        state: customerDetails.state,
      }).total,
  );

  const cleanerCharge =
    shoeCleanerAddon && addShoeCleaner ? SHOE_CLEANER_PRICE : 0;

  const selectedCustomAddons = customAddons.filter((a) =>
    selectedAddonKeys.includes(a._key),
  );
  const customAddonsCharge = selectedCustomAddons.reduce(
    (sum, a) => sum + (Number(a.price) || 0),
    0,
  );

  const totalAmount =
    subtotal + shippingCharge + cleanerCharge + customAddonsCharge;

  // COD advance: same helper the server uses.
  const isCod = shippingMethod === "cod";
  const codAdvance = getCodAdvance(offerType, customerDetails.state);
  const remainingAmount = isCod ? totalAmount - codAdvance : 0;

  const onlineDelivery = getExpectedDelivery(
    ONLINE_DELIVERY_MIN_DAYS,
    ONLINE_DELIVERY_MAX_DAYS,
    orderDate,
  );
  const codDelivery = getExpectedDelivery(
    COD_DELIVERY_MIN_DAYS,
    COD_DELIVERY_MAX_DAYS,
    orderDate,
  );
  const activeDelivery =
    shippingMethod === "online" ? onlineDelivery : codDelivery;

  /* ----- Validation ----- */

  const phoneValid = /^\d{10}$/.test(customerDetails.contact1.trim());
  const pincodeValid = /^\d{6}$/.test(customerDetails.pincode.trim());
  const missingFields = REQUIRED_FIELDS.filter(
    (field) => !customerDetails[field]?.trim(),
  );
  const isFormValid = missingFields.length === 0 && phoneValid && pincodeValid;

  const getFieldError = (field: string): string | undefined => {
    if (!touched[field]) return undefined;
    if (
      (REQUIRED_FIELDS as readonly string[]).includes(field) &&
      !customerDetails[field as keyof CustomerDetails]?.trim()
    ) {
      return "This field is required";
    }
    if (
      field === "contact1" &&
      customerDetails.contact1.trim() &&
      !phoneValid
    ) {
      return "Enter a valid 10-digit phone number";
    }
    if (
      field === "pincode" &&
      customerDetails.pincode.trim() &&
      !pincodeValid
    ) {
      return "Enter a valid 6-digit pincode";
    }
    return undefined;
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setCustomerDetails((prev) => ({ ...prev, [name]: value }));
  };

  const handleStateChange = (state: string) => {
    setCustomerDetails((prev) => ({ ...prev, state }));
    setTouched((prev) => ({ ...prev, state: true }));
  };

  const handleInputBlur = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
  };

  /* ----- Pixel + WhatsApp fallback ----- */

  const buildPixelPayload = () => {
    const ids = [mainProduct?._id].filter(Boolean) as string[];
    if (hasFreePair && freeProduct?._id) ids.push(freeProduct._id);
    return {
      content_ids: ids,
      content_type: "product" as const,
      contents: ids.map((id) => ({ id, quantity: 1 })),
      num_items: pairCount,
      currency: "INR",
    };
  };

  const buildWhatsAppMessage = (reason: string) => {
    let pairLines = [
      `*${isOnePair ? "Selected Pair" : "PAIR 1"} :* ${SITE_ORIGIN}/p/${mainProduct?._id}\nSize: ${mainProduct?.selectedSize || "N/A"}`,
    ];
    if (hasFreePair && freeProduct) {
      pairLines.push(
        `*PAIR 2 (FREE) :* ${SITE_ORIGIN}/p/${freeProduct._id}\nSize: ${freeProduct.selectedSize || "N/A"}`,
      );
    }
    if (hasRandomPair) {
      pairLines.push(
        `*PAIR ${randomPairNo} (FREE) :* Random Surprise Pair\nSize: ${randomPairSize || "N/A"}\nStyle: picked by us at packing`,
      );
    }

    const title = isOnePair ? "Your Selected Pair" : `${pairCount} PAIR COMBO`;

    const shippingLine =
      shippingCharge === 0
        ? "Free (Prepaid)"
        : `₹${shippingCharge} (${isCod ? "COD" : "Prepaid"})`;

    const customAddonLines = selectedCustomAddons
      .map((a) => `- Add-on: ${a.title} (+₹${a.price})\n`)
      .join("");

    return `*ORDER CONFIRMATION – ${title}*
⚠️ ${reason}. Please confirm this order manually.

*CUSTOMER INFORMATION*
Name: ${customerDetails.name}
Instagram ID: ${customerDetails.instagramId || "N/A"}
Address: ${customerDetails.address}
District: ${customerDetails.district}
State: ${customerDetails.state}
Pincode: ${customerDetails.pincode}
Landmark: ${customerDetails.landmark || "N/A"}
Phone 1: ${customerDetails.contact1}
Alternative Phone 2: ${customerDetails.contact2 || "N/A"}

*PRODUCT DETAILS*

${pairLines.join("\n\n")}

*PAYMENT SUMMARY*
- Product Price: ₹${subtotal}
${freeSocksOffer ? "- Free socks included\n" : ""}${cleanerCharge > 0 ? `- Add-on: Shoe Cleaner (+₹${SHOE_CLEANER_PRICE})\n` : ""}${customAddonLines}- Shipping: ${shippingLine}
${isCod ? `- Advance attempted: ₹${codAdvance}\n` : ""}
*Total Amount Payable: ₹${totalAmount}✅*`.trim();
  };

  const redirectToWhatsAppFallback = (reason: string) => {
    // Order wasn't confirmed by Razorpay: custom event, not a Purchase.
    fbTrackCustom("WhatsAppOrderHandoff", {
      value: totalAmount,
      currency: "INR",
      reason,
    });

    const url = `https://wa.me/${site.phone}?text=${encodeURIComponent(
      buildWhatsAppMessage(reason),
    )}`;
    // May be blocked (async, iOS Safari). The fallback screen has a link.
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {}
    localStorage.removeItem("cart");
    window.dispatchEvent(new Event("cartUpdated"));
    setWaFallback({ url, reason });
    setIsLoading(false);
  };

  /* ----- Pay flow ----- */

  // Step 1: validate, then show the alert popup
  const handlePayClick = () => {
    setTouched((prev) => {
      const next = { ...prev };
      REQUIRED_FIELDS.forEach((field) => {
        next[field] = true;
      });
      return next;
    });

    if (!isFormValid) {
      const errors: string[] = [];
      if (!customerDetails.name.trim()) errors.push("Enter your name");
      if (!phoneValid) errors.push("Enter a valid 10-digit mobile number");
      if (!customerDetails.address.trim()) errors.push("Enter your address");
      if (!customerDetails.district.trim()) errors.push("Enter your district");
      if (!customerDetails.state.trim()) errors.push("Select your state");
      if (!pincodeValid) errors.push("Enter a 6-digit pincode");
      setFormErrors(errors);
      return;
    }
    setFormErrors([]);
    setShowPayAlert(true);
  };

  // Step 2: runs after the user confirms the popup
  const handleRazorpayPayment = async () => {
    setIsLoading(true);
    setFormErrors([]);

    const loaded = await loadRazorpay();
    if (!loaded) {
      redirectToWhatsAppFallback("Payment gateway is currently unavailable");
      return;
    }

    try {
      // Send only identifiers + selected options. Server computes money.
      const lines = [
        {
          productId: mainProduct._id,
          selectedSize: mainProduct.selectedSize,
          isFreeItem: false,
        },
      ];
      if (hasFreePair && freeProduct) {
        lines.push({
          productId: freeProduct._id,
          selectedSize: freeProduct.selectedSize,
          isFreeItem: true,
        });
      }

      const createRes = await fetch("/api/checkout/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerType,
          lines,
          customerDetails,
          shippingMethod,
          addShoeCleaner: shoeCleanerAddon && addShoeCleaner,
          customAddonKeys: selectedAddonKeys,
          freeSocksOffer,
          // Random surprise pair (two pair offer). Server must accept and
          // store these on the order so you know what to pack.
          hasRandomPair,
          randomPairSize,
          expectedDeliveryLabel: activeDelivery.label,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData?.error || "Could not create order");
      }

      const { razorpayOrder, paymentAmount: serverPaymentAmount } = createData;

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        name: site.name || "footmart",
        description: isCod
          ? `COD Advance Payment (${inr(codAdvance)})`
          : `${pairCount} Pair Shoes Order`,
        order_id: razorpayOrder.id,
        prefill: {
          name: customerDetails.name,
          contact: customerDetails.contact1,
        },
        theme: { color: "#000000" },
        handler: async (response: any) => {
          try {
            const verifyRes = await fetch("/api/checkout/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(response), // only razorpay_* fields
            });
            const verifyData = await verifyRes.json();

            if (!verifyData.success) {
              redirectToWhatsAppFallback("Payment verification failed");
              return;
            }

            fbEvent(
              "Purchase",
              {
                ...buildPixelPayload(),
                value: serverPaymentAmount,
              },
              response.razorpay_payment_id,
            );

            localStorage.removeItem("cart");
            window.dispatchEvent(new Event("cartUpdated"));
            router.push(
              `/order-confirmed?payment_id=${response.razorpay_payment_id}&order_id=${verifyData.orderId}`,
            );
          } catch {
            redirectToWhatsAppFallback("We couldn't confirm your payment");
          }
        },
        modal: { ondismiss: () => setIsLoading(false) },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", () =>
        redirectToWhatsAppFallback("Your payment failed"),
      );
      rzp.open();
    } catch (e: any) {
      redirectToWhatsAppFallback(e?.message || "We couldn't start the payment");
    }
  };

  /* ----- Loading ----- */
  if (!cartLoaded) {
    return (
      <main className="mx-auto min-h-screen max-w-xl px-4 pt-4" aria-busy>
        <div className="h-1 animate-pulse rounded-full bg-muted" />
        <div className="mt-6 h-12 w-2/3 animate-pulse rounded-xl bg-muted" />
        <div className="mt-6 h-20 animate-pulse rounded-2xl bg-muted" />
        <div className="mt-3 h-20 animate-pulse rounded-2xl bg-muted" />
      </main>
    );
  }

  /* ----- Payment not completed: WhatsApp handoff ----- */
  if (waFallback) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-4 duration-500 animate-in fade-in slide-in-from-bottom-3">
        <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-black">
          <WarnIcon className="h-8 w-8" />
        </span>
        <h1 className={H1}>
          Confirm on <span className={CHIP}>WhatsApp.</span>
        </h1>
        <p className="mt-4 max-w-sm font-medium text-amber-700">
          {waFallback.reason}.
        </p>
        <p className="mb-8 mt-2 max-w-sm text-muted-foreground">
          Send the pre-filled message in WhatsApp to confirm your order. If it
          did not open, use the button below. If money was deducted, attach
          your payment screenshot.
        </p>
        <a
          href={waFallback.url}
          target="_blank"
          rel="noopener noreferrer"
          className={PILL}
        >
          <PillContent>Open WhatsApp</PillContent>
        </a>
        <Link
          href="/"
          className="mt-5 text-center text-sm font-bold underline underline-offset-4"
        >
          Back to shop
        </Link>
      </main>
    );
  }

  /* ----- Empty / invalid cart ----- */
  if (!cartItems.length || !mainProduct) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-4 duration-500 animate-in fade-in">
        <h1 className={H1}>
          {!cartItems.length
            ? "Your cart is empty."
            : "Your cart has invalid items."}
        </h1>
        <p className="mb-8 mt-4 text-muted-foreground">
          {!cartItems.length
            ? "Pick a pair to get started."
            : "Clear it and start again."}
        </p>
        <PillCTA
          onClick={() => {
            localStorage.removeItem("cart");
            router.push("/");
          }}
        >
          {!cartItems.length ? "Continue shopping" : "Start over"}
        </PillCTA>
      </main>
    );
  }

  /* ----- Checkout ----- */
  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 pb-52 pt-2">
      <StepBar step={currentStep} />

      {isLoading && (
        <div
          role="status"
          className="mt-4 flex items-start gap-3 rounded-2xl bg-amber-100 p-4 text-sm font-medium text-amber-900"
        >
          <WarnIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p>
            Payment in progress. Don&apos;t close, refresh or go back until you
            reach the order confirmation page. If you switch UPI apps, return
            to this page after paying.
          </p>
        </div>
      )}

      {/* key remounts the block so each step enters with the same motion */}
      <div
        key={currentStep}
        className="duration-500 animate-in fade-in slide-in-from-bottom-3 motion-reduce:animate-none"
      >
        {currentStep === "payment" ? (
          <>
            <h1 className={`mt-5 ${H1}`}>
              Your{" "}
              <span className={CHIP}>
                {pairCount} {pairCount === 1 ? "pair" : "pairs"}
              </span>
              .
            </h1>

            <section className="mt-6 space-y-2" aria-label="Your pairs">
              <PairRow product={mainProduct} label="1st pair" />
              {hasFreePair && (
                <PairRow product={freeProduct} label="2nd pair free" free />
              )}
              {hasRandomPair && (
                <PairRow
                  random
                  free
                  size={randomPairSize}
                  label={`${ordinal(randomPairNo)} pair free`}
                />
              )}
            </section>

            <section className="mt-8" aria-labelledby="pay-title">
              <h2 id="pay-title" className={`mb-3 text-xl ${DISPLAY}`}>
                Payment
              </h2>
              <div
                role="radiogroup"
                aria-labelledby="pay-title"
                className="space-y-2"
              >
                <PayOption
                  id="online"
                  checked={shippingMethod === "online"}
                  onSelect={() => setShippingMethod("online")}
                  title="Online payment"
                  tag={
                    getShippingBreakdown({
                      offerType,
                      shippingMethod: "online",
                      state: customerDetails.state,
                    }).total === 0
                      ? "Free shipping"
                      : `+${inr(
                          getShippingBreakdown({
                            offerType,
                            shippingMethod: "online",
                            state: customerDetails.state,
                          }).total,
                        )} shipping`
                  }
                  strongTag
                >
                  {prepaidSavings > 0 && (
                    <p className="font-bold text-black">
                      Save {inr(prepaidSavings)} vs COD
                    </p>
                  )}
                  <p>
                    Delivery in {ONLINE_DELIVERY_MIN_DAYS} to{" "}
                    {ONLINE_DELIVERY_MAX_DAYS} days
                  </p>
                </PayOption>

                <PayOption
                  id="cod"
                  checked={isCod}
                  onSelect={() => setShippingMethod("cod")}
                  title="Cash on delivery"
                  tag={`${inr(codAdvance)} advance`}
                >
                  <p>
                    Pay {inr(codAdvance)} now, the rest on delivery.
                    {prepaidSavings > 0 &&
                      ` Pay online to save ${inr(prepaidSavings)}.`}
                  </p>
                  <p>
                    Delivery in {COD_DELIVERY_MIN_DAYS} to{" "}
                    {COD_DELIVERY_MAX_DAYS} days
                  </p>
                </PayOption>
              </div>
            </section>

            {(freeSocksOffer ||
              shoeCleanerAddon ||
              customAddons.length > 0) && (
              <section
                className="mt-8 duration-500 animate-in fade-in slide-in-from-bottom-2"
                aria-labelledby="addon-title"
              >
                <h2 id="addon-title" className={`mb-3 text-xl ${DISPLAY}`}>
                  Add-ons
                </h2>
                <div className="space-y-2">
                  {freeSocksOffer && (
                    <div className="flex items-center justify-between gap-3 rounded-2xl bg-primary p-4 shadow-[inset_0_0_0_2px_#000]">
                      <div>
                        <p className="text-sm font-bold tracking-tight">
                          Free socks
                        </p>
                        <p className="mt-1 text-xs text-black/70">
                          Included with your order.
                        </p>
                      </div>
                      <span className="rounded-full bg-black px-2 py-0.5 text-xs font-bold text-primary">
                        FREE
                      </span>
                    </div>
                  )}
                  {shoeCleanerAddon && (
                    <AddOn
                      checked={addShoeCleaner}
                      onToggle={() => setAddShoeCleaner((v) => !v)}
                      title="Premium Shoe Cleaner"
                      desc="Keep all your pairs looking fresh."
                      price={inr(SHOE_CLEANER_PRICE)}
                      was="₹199"
                      tag="Limited offer"
                    />
                  )}
                  {customAddons.map((a) => (
                    <AddOn
                      key={a._key}
                      checked={selectedAddonKeys.includes(a._key)}
                      onToggle={() => toggleCustomAddon(a._key)}
                      title={a.title}
                      desc={a.description}
                      price={inr(Number(a.price) || 0)}
                      imageUrl={a.imageUrl}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setCurrentStep("payment")}
              disabled={isLoading}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-30"
            >
              <ArrowIcon className="h-4 w-4 rotate-180" /> Back
            </button>

            <h1 className={`mt-3 ${H1}`}>
              Where should
              <br />
              we <span className={CHIP}>send it?</span>
            </h1>

            {formErrors.length > 0 && (
              <div
                ref={errorRef}
                role="alert"
                className="mt-6 rounded-2xl bg-destructive/10 p-4 text-sm font-medium text-destructive duration-300 animate-in fade-in slide-in-from-top-2"
              >
                <p className="mb-1 font-bold">Fix these to continue</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {formErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6">
              <CustomerDetailsForm
                customerDetails={customerDetails}
                handleInputChange={handleInputChange}
                handleInputBlur={handleInputBlur}
                handleStateChange={handleStateChange}
                getFieldError={getFieldError}
              />
            </div>
          </>
        )}

        {/* Summary */}
        <section className="mt-10" aria-labelledby="summary-title">
          <h2 id="summary-title" className={`mb-3 text-xl ${DISPLAY}`}>
            Summary
          </h2>
          <div className="space-y-2.5 rounded-2xl bg-muted p-4">
            <Row
              label={`Base price (${pairCount} ${pairCount === 1 ? "pair" : "pairs"})`}
              value={inr(offerBasePrice)}
            />
            {pair1Extra > 0 && (
              <Row
                indent
                muted
                label="Extra, pair 1"
                value={`+${inr(pair1Extra)}`}
              />
            )}
            {pair2Extra > 0 && (
              <Row
                indent
                muted
                label="Extra, pair 2"
                value={`+${inr(pair2Extra)}`}
              />
            )}
            {hasRandomPair && (
              <Row
                indent
                muted
                label={`Random surprise pair${
                  randomPairSize ? ` (size ${randomPairSize})` : ""
                }`}
                value="FREE"
              />
            )}
            {freeSocksOffer && (
              <Row indent muted label="Socks" value="FREE" />
            )}
            {cleanerCharge > 0 && (
              <Row label="Shoe cleaner" value={`+${inr(SHOE_CLEANER_PRICE)}`} />
            )}
            {selectedCustomAddons.map((a) => (
              <Row
                key={a._key}
                label={a.title}
                value={`+${inr(Number(a.price) || 0)}`}
              />
            ))}
            <Row
              label={
                isCod ? "Shipping (COD)" : "Shipping (online)"
              }
              value={shippingCharge === 0 ? "FREE" : inr(shippingCharge)}
            />
            {outsideKeralaExtra > 0 && (
              <Row
                indent
                muted
                label="Outside Kerala (included above)"
                value={`+${inr(outsideKeralaExtra)}`}
              />
            )}
            <div className="flex items-baseline justify-between border-t border-black/10 pt-3">
              <span className="text-sm font-bold">Total</span>
              <span className={`text-2xl ${DISPLAY}`}>{inr(totalAmount)}</span>
            </div>
            {isCod && (
              <p className="text-xs text-muted-foreground">
                {inr(codAdvance)} advance now, {inr(remainingAmount)} on
                delivery
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Estimated delivery {activeDelivery.label}
            </p>
          </div>

          {isCod && prepaidSavings > 0 && (
            <button
              type="button"
              onClick={() => setShippingMethod("online")}
              className="mt-3 w-full text-center text-sm font-bold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Switch to online payment and save {inr(prepaidSavings)}
            </button>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            By ordering you agree to the{" "}
            <Link href="/terms" className="font-bold text-black underline">
              Terms and Conditions
            </Link>
            .
          </p>
        </section>
      </div>

      {/* Bottom bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 rounded-t-3xl bg-background px-4 pt-4 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.25)]"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto flex max-w-xl items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">
              {isCod && currentStep === "details" ? "Pay now" : "Total"}
            </p>
            <p className={`text-2xl leading-none ${DISPLAY}`}>
              {inr(
                isCod && currentStep === "details" ? codAdvance : totalAmount,
              )}
            </p>
          </div>
          {currentStep === "payment" ? (
            <PillCTA
              onClick={() => setCurrentStep("details")}
              className="min-w-[180px]"
            >
              Continue
            </PillCTA>
          ) : (
            <PillCTA
              onClick={handlePayClick}
              disabled={isLoading}
              loading={isLoading}
              className="min-w-[200px]"
            >
              {isLoading
                ? "Processing"
                : isCod
                  ? "Pay advance"
                  : "Pay now"}
            </PillCTA>
          )}
        </div>
        {currentStep === "details" && (
          <p className="mx-auto mt-2 max-w-xl text-center text-xs text-muted-foreground">
            Secure payment via Razorpay. Don&apos;t close this page until you
            see the confirmation.
          </p>
        )}
      </div>

      <AlertDialog open={showPayAlert} onOpenChange={setShowPayAlert}>
        <AlertDialogContent className="max-w-sm rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <WarnIcon className="h-5 w-5 text-amber-600" />
              Before you pay
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left text-sm">
                <p>
                  Do <strong>not</strong> close, refresh or go back until you
                  see the <strong>order confirmation page</strong>.
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    Switching UPI apps is fine. Return to this page after
                    paying.
                  </li>
                  <li>
                    Your order is confirmed only when the confirmation page
                    appears.
                  </li>
                  <li>
                    If money is deducted and you don&apos;t see it, WhatsApp us
                    with your payment screenshot.
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="rounded-full">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              onClick={() => {
                setShowPayAlert(false);
                handleRazorpayPayment();
              }}
            >
              I understand, continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}