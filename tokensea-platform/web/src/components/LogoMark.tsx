export function LogoMark({
  size = 40,
  className,
  style,
}: {
  size?: number
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span className={className} style={{ display: "inline-flex", width: size, height: size, ...style }}>
      <img src="/shared/logo-mark-dark.png" alt="" width={size} height={size} className="dark:hidden" />
      <img
        src="/shared/logo-mark.png"
        alt=""
        width={size}
        height={size}
        className="hidden dark:block"
      />
    </span>
  )
}
