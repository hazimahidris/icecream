type ProductImageProps = {
  src: string | null;
  alt: string;
  className?: string;
};

export function ProductImage({ src, alt, className = "" }: ProductImageProps) {
  if (!src) {
    return (
      <div
        className={`flex aspect-square w-full items-center justify-center rounded-t-lg bg-gray-100 text-4xl dark:bg-gray-800 ${className}`}
      >
        🍦
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      className={`aspect-square w-full rounded-t-lg object-cover ${className}`}
    />
  );
}
