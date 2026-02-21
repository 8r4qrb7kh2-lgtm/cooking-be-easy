import Image from "next/image";
import cookingBeEasyLogo from "../cooking-be-easy logo.png";

interface GooseChefLogoProps {
  className?: string;
  size?: number;
  variant?: "full" | "header";
}

export default function GooseChefLogo({
  className,
  size = 24,
  variant = "full",
}: GooseChefLogoProps) {
  const width = Math.round((cookingBeEasyLogo.width / cookingBeEasyLogo.height) * size);

  if (variant === "header") {
    return (
      <Image
        src={cookingBeEasyLogo}
        alt="Cooking be easy logo"
        width={width}
        height={size}
        sizes={`${width}px`}
        style={{ width: `${width}px`, height: `${size}px` }}
        className={`shrink-0 ${className ?? ""}`}
      />
    );
  }

  return (
    <Image
      src={cookingBeEasyLogo}
      alt="Cooking be easy logo"
      width={width}
      height={size}
      sizes={`${width}px`}
      style={{ width: `${width}px`, height: `${size}px` }}
      className={className}
    />
  );
}
