import { LogoMark } from "@/components/LogoMark"

export function AuthBrand() {
  return (
    <div className="flex items-center gap-3" aria-label="TokenSea">
      <LogoMark size={32} />
      <span className="font-sans text-[34px] font-extrabold leading-none tracking-[-0.045em] text-[#102a4d] dark:text-[#f4f9ff]">
        Token<span className="text-[#1688e8] dark:text-[#75c8ff]">sea</span>
      </span>
    </div>
  )
}
