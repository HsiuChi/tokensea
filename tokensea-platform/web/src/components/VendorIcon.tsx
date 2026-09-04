import deepSeekLogo from "@lobehub/icons-static-svg/icons/deepseek-color.svg"
import moonshotLogo from "@lobehub/icons-static-svg/icons/moonshot.svg"
import qwenLogo from "@lobehub/icons-static-svg/icons/qwen-color.svg"
import xiaomiMimoLogo from "@lobehub/icons-static-svg/icons/xiaomimimo.svg"
import zhipuLogo from "@lobehub/icons-static-svg/icons/zhipu-color.svg"
import volcengineLogo from "@lobehub/icons-static-svg/icons/volcengine-color.svg"
import klingLogo from "@lobehub/icons-static-svg/icons/kling-color.svg"
import hailuoLogo from "@lobehub/icons-static-svg/icons/hailuo-color.svg"

function BrandLogo({
  src,
  name,
  size,
  className = "",
}: {
  src: string
  name: string
  size: number
  className?: string
}) {
  return (
    <img
      src={src}
      alt={`${name} logo`}
      width={size}
      height={size}
      className={`shrink-0 object-contain ${className}`}
    />
  )
}

export function VendorIcon({ name, size = 24 }: { name: string | undefined | null; size?: number }) {
  if (!name) return null

  const lower = name.toLowerCase()

  if (lower.includes("deepseek")) {
    return <BrandLogo src={deepSeekLogo} name="DeepSeek" size={size} />
  }

  if (lower.includes("kimi") || lower.includes("moonshot")) {
    return <BrandLogo src={moonshotLogo} name="Moonshot Kimi" size={size} className="dark:invert" />
  }

  if (lower.includes("qwen")) {
    return <BrandLogo src={qwenLogo} name="Qwen" size={size} />
  }

  if (lower.includes("zhipu") || lower.includes("chatglm") || lower.startsWith("glm")) {
    return <BrandLogo src={zhipuLogo} name="Zhipu AI" size={size} />
  }

  if (lower.includes("xiaomi") || lower.includes("mimo")) {
    return <BrandLogo src={xiaomiMimoLogo} name="Xiaomi MiMo" size={size} className="dark:invert" />
  }

  if (lower.includes("seedance") || lower.includes("volcengine")) {
    return <BrandLogo src={volcengineLogo} name="Seedance" size={size} />
  }

  if (lower.includes("kling")) {
    return <BrandLogo src={klingLogo} name="Kling AI" size={size} />
  }

  if (lower.includes("hailuo") || lower.includes("minimax")) {
    return <BrandLogo src={hailuoLogo} name="Hailuo AI" size={size} />
  }

  if (lower.includes("claude")) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" />
      </svg>
    )
  }

  if (lower.includes("gpt") || lower.includes("openai") || lower.includes("o1") || lower.includes("o3") || lower.includes("dall")) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.282 9.821a5.985 5.985 0 00-.516-4.91 6.046 6.046 0 00-6.51-2.9A6.065 6.065 0 0011.724.47a6.064 6.064 0 00-5.822 3.534 6.043 6.043 0 00-4.017 2.947 6.052 6.052 0 00.75 7.09 5.98 5.98 0 00.516 4.911 6.051 6.051 0 006.51 2.9A6.056 6.056 0 0013.21 24a6.064 6.064 0 005.822-3.534 6.044 6.044 0 004.017-2.947 6.056 6.056 0 00-.75-7.09l.983-.608zm-9.158 12.81a4.476 4.476 0 01-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 00.392-.681v-6.737l2.02 1.168a.071.071 0 01.038.052v5.583a4.504 4.504 0 01-4.494 4.494zM3.66 18.374a4.47 4.47 0 01-.535-3.014l.142.085 4.783 2.759a.771.771 0 00.78 0l5.843-3.369v2.332a.08.08 0 01-.033.062L9.74 20.01a4.502 4.502 0 01-6.08-1.636zM2.339 7.895a4.485 4.485 0 012.366-1.973V11.6a.766.766 0 00.388.676l5.815 3.355-2.02 1.168a.076.076 0 01-.071 0l-4.83-2.786A4.504 4.504 0 012.339 7.89zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 01.071 0l4.83 2.791a4.494 4.494 0 01-.752 8.128v-5.678a.79.79 0 00-.332-.691zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 00-.785 0L9.409 9.23V6.897a.066.066 0 01.028-.061l4.83-2.787a4.5 4.5 0 016.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 01-.038-.057V6.075a4.5 4.5 0 017.375-3.453l-.142.08L8.704 5.46a.795.795 0 00-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" fill="currentColor" />
      </svg>
    )
  }

  // Fallback
  const firstLetter = name.charAt(0).toUpperCase()
  return (
    <div
      className="flex items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400"
      style={{ width: size, height: size }}
    >
      {firstLetter}
    </div>
  )
}
