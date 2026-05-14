import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ImageIcon, Wand2, Download, AlertCircle } from "lucide-react"

interface GeneratedImage {
  url?: string
  b64_json?: string
  revised_prompt?: string
}

export function ImageGenPage() {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState("")
  const [model, setModel] = useState("dall-e-3")
  const [n, setN] = useState("1")
  const [size, setSize] = useState("1024x1024")
  const [quality, setQuality] = useState("standard")
  const [style, setStyle] = useState("vivid")
  const [loading, setLoading] = useState(false)
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [error, setError] = useState("")

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    setLoading(true)
    setError("")
    setImages([])

    try {
      const res = await fetch("/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          model,
          prompt: prompt.trim(),
          n: Number(n),
          size,
          quality,
          style,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error?.message || `Request failed: ${res.status}`)
      }

      const data = await res.json()
      setImages(data.data || [])
    } catch (err: any) {
      setError(err.message || t("imageGen.error", { defaultValue: "Generation failed" }))
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = (url: string, index: number) => {
    const a = document.createElement("a")
    a.href = url
    a.download = `generated-${index + 1}.png`
    a.target = "_blank"
    a.click()
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("imageGen.title", { defaultValue: "Image Generation" })}</h1>
        <p className="text-muted-foreground">{t("imageGen.subtitle", { defaultValue: "Generate images from text prompts using AI models" })}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("imageGen.settings", { defaultValue: "Settings" })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("imageGen.model", { defaultValue: "Model" })}</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dall-e-3">DALL·E 3</SelectItem>
                  <SelectItem value="dall-e-2">DALL·E 2</SelectItem>
                  <SelectItem value="gpt-image-1">GPT Image 1</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("imageGen.prompt", { defaultValue: "Prompt" })}</label>
              <Textarea
                placeholder={t("imageGen.promptPlaceholder", { defaultValue: "Describe the image you want to generate..." })}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("imageGen.size", { defaultValue: "Size" })}</label>
                <Select value={size} onValueChange={setSize}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1024x1024">1024×1024</SelectItem>
                    <SelectItem value="1024x1536">1024×1536</SelectItem>
                    <SelectItem value="1536x1024">1536×1024</SelectItem>
                    <SelectItem value="1792x1024">1792×1024</SelectItem>
                    <SelectItem value="1024x1792">1024×1792</SelectItem>
                    <SelectItem value="512x512">512×512</SelectItem>
                    <SelectItem value="256x256">256×256</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("imageGen.count", { defaultValue: "Count" })}</label>
                <Select value={n} onValueChange={setN}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="4">4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("imageGen.quality", { defaultValue: "Quality" })}</label>
                <Select value={quality} onValueChange={setQuality}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="hd">HD</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("imageGen.style", { defaultValue: "Style" })}</label>
                <Select value={style} onValueChange={setStyle}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vivid">Vivid</SelectItem>
                    <SelectItem value="natural">Natural</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              className="w-full"
              disabled={loading || !prompt.trim()}
              onClick={handleGenerate}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  {t("imageGen.generating", { defaultValue: "Generating..." })}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Wand2 className="h-4 w-4" />
                  {t("imageGen.generate", { defaultValue: "Generate" })}
                </span>
              )}
            </Button>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        <Card className="min-h-[480px]">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              {t("imageGen.results", { defaultValue: "Results" })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {images.length === 0 && !loading && !error && (
              <div className="h-[400px] flex flex-col items-center justify-center text-muted-foreground">
                <ImageIcon className="h-12 w-12 mb-4 opacity-20" />
                <p className="text-sm">{t("imageGen.empty", { defaultValue: "Generated images will appear here" })}</p>
              </div>
            )}

            {loading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from({ length: Number(n) }).map((_, i) => (
                  <Skeleton key={i} className="aspect-square rounded-xl" />
                ))}
              </div>
            )}

            {images.length > 0 && !loading && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {images.map((img, i) => (
                    <div key={i} className="group relative rounded-xl border bg-muted overflow-hidden">
                      {img.url ? (
                        <img
                          src={img.url}
                          alt={img.revised_prompt || `Generated ${i + 1}`}
                          className="w-full h-full object-cover aspect-square"
                          loading="lazy"
                        />
                      ) : img.b64_json ? (
                        <img
                          src={`data:image/png;base64,${img.b64_json}`}
                          alt={img.revised_prompt || `Generated ${i + 1}`}
                          className="w-full h-full object-cover aspect-square"
                        />
                      ) : (
                        <div className="aspect-square flex items-center justify-center text-muted-foreground text-sm">
                          {t("imageGen.noPreview", { defaultValue: "No preview" })}
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="flex items-center justify-between">
                          {img.revised_prompt && (
                            <p className="text-xs text-white truncate max-w-[70%]">{img.revised_prompt}</p>
                          )}
                          {img.url && (
                            <button
                              onClick={() => handleDownload(img.url!, i)}
                              className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-white hover:bg-white/40 transition"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {images[0]?.revised_prompt && (
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-500 mb-1">{t("imageGen.revisedPrompt", { defaultValue: "Revised prompt" })}</p>
                    <p className="text-sm text-slate-700">{images[0].revised_prompt}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
