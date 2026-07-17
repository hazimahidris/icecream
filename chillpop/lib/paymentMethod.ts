export type PaymentMethod = "cash" | "qr" | "online_transfer";

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "qr", label: "QR" },
  { value: "online_transfer", label: "Online Transfer" },
];

export function paymentMethodLabel(method: string) {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}
