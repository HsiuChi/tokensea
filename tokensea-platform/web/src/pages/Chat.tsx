import { useState, useRef, useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { api } from "@/services/api"
import { VendorIcon } from "@/components/VendorIcon"
import {
  Send,
  Square,
  Trash2,
  Plus,
  Copy,
  Check,
  MessageSquare,
  X,
  ChevronLeft,
  Wand2,
  Download,
  Bot,
  UserCircle,
  FileText,
  FileSpreadsheet,
  FileImage,
  Loader2,
} from "lucide-react"
import { getDocument } from "pdfjs-dist"
import { read, utils } from "xlsx"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeneratedImage {
  url?: string
  b64_json?: string
  revised_prompt?: string
}

interface Message {
  role: "system" | "user" | "assistant"
  content: string
  imageUrl?: string
  imageUrls?: string[]
  generatedImages?: GeneratedImage[]
}

interface Chat {
  id: string
  title: string
  model: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

interface FileAttachment {
  id: string
  file: File
  name: string
  ext: string
  type: "text" | "image" | "pdf" | "excel" | "unsupported"
  status: "extracting" | "ready" | "error"
  content?: string
  imageUrl?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ImageBlock({ img, idx, onDownload }: { img: GeneratedImage; idx: number; onDownload: (url: string, idx: number) => void }) {
  const src = img.url || (img.b64_json ? "data:image/png;base64," + img.b64_json : "")
  return (
    <div className="group/img relative rounded-xl overflow-hidden">
      {src ? (
        <img src={src} alt={img.revised_prompt || "Generated " + (idx + 1)} className="w-full object-contain rounded-xl" loading="lazy" />
      ) : (
        <div className="flex items-center justify-center text-slate-400 text-sm dark:text-slate-500 py-8">No preview</div>
      )}
      {src && (
        <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity">
          <div className="flex items-center justify-end">
            <button onClick={() => onDownload(src, idx)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-white hover:bg-white/40 transition">
              <Download className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const STORAGE_CHATS = "chat_sessions"
const STORAGE_CONFIG = "chat_config"

function loadChats(): Chat[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CHATS) || "[]")
  } catch {
    return []
  }
}

function saveChats(chats: Chat[]) {
  localStorage.setItem(STORAGE_CHATS, JSON.stringify(chats))
}

function loadConfig(): { model: string } | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CONFIG) || "null")
  } catch {
    return null
  }
}

function saveConfig(cfg: { model: string }) {
  localStorage.setItem(STORAGE_CONFIG, JSON.stringify(cfg))
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang: string, code: string) =>
      `<pre class="bg-slate-900 text-slate-100 rounded-lg p-3 my-2 overflow-x-auto text-xs"><code${
        lang ? ` class="language-${lang}"` : ""
      }>${code}</code></pre>`
  )

  html = html.replace(
    /`([^`\n]+)`/g,
    '<code class="bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded text-xs font-mono">$1</code>'
  )

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-3 mb-1">$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-3 mb-1">$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold mt-3 mb-1">$1</h1>')
  html = html.replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
  html = html.replace(/\n{2,}/g, "</p><p>")
  html = html.replace(/\n/g, "<br />")

  if (!html.startsWith("<")) html = `<p>${html}</p>`
  return html
}

// ---------------------------------------------------------------------------
// File extraction
// ---------------------------------------------------------------------------

const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "rst", "tex", "csv", "tsv", "log",
  "js", "ts", "jsx", "tsx", "mjs", "cjs",
  "py", "pyw", "ipynb",
  "json", "jsonc", "jsonl", "xml", "yaml", "yml", "toml",
  "html", "htm", "xhtml", "css", "scss", "sass", "less", " Stylus",
  "vue", "svelte", "astro",
  "sql", "hql", "cql",
  "c", "cpp", "cc", "cxx", "h", "hpp",
  "go", "java", "kt", "kts", "scala", "groovy",
  "rs", "swift", "dart", "lua", "r", "m", "mm",
  "php", "rb", "erb", "pl", "pm", "t",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "dockerfile", "makefile", "cmake", "gradle", "properties", "ini", "conf",
  "graphql", "gql", "prisma", "proto",
])

function getFileType(file: File): FileAttachment["type"] {
  const ext = file.name.split(".").pop()?.toLowerCase() || ""
  if (file.type.startsWith("image/")) return "image"
  if (file.type === "application/pdf" || ext === "pdf") return "pdf"
  if (
    file.type.includes("sheet") ||
    file.type === "text/csv" ||
    ["xlsx", "xls", "csv", "ods"].includes(ext)
  )
    return "excel"
  if (file.type.startsWith("text/") || TEXT_EXTS.has(ext)) return "text"
  return "unsupported"
}

async function extractFileContent(
  file: File,
  type: FileAttachment["type"]
): Promise<Pick<FileAttachment, "content" | "imageUrl" | "error">> {
  if (type === "image") {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve({ imageUrl: reader.result as string })
      reader.readAsDataURL(file)
    })
  }

  if (type === "text") {
    const text = await file.text()
    return { content: text.slice(0, 50000) }
  }

  if (type === "pdf") {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await getDocument({ data: arrayBuffer }).promise
      let text = ""
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        text += content.items.map((item: any) => item.str).join(" ") + "\n\n"
      }
      return { content: text.slice(0, 50000) }
    } catch (e: any) {
      return { error: e.message || "Failed to parse PDF" }
    }
  }

  if (type === "excel") {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const workbook = read(arrayBuffer)
      let text = ""
      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName]
        text += `--- Sheet: ${sheetName} ---\n`
        text += utils.sheet_to_csv(sheet) + "\n\n"
      })
      return { content: text.slice(0, 50000) }
    } catch (e: any) {
      return { error: e.message || "Failed to parse Excel" }
    }
  }

  return { error: "Unsupported file type" }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatPage() {
  const { t } = useTranslation()

  const [searchParams] = useSearchParams()
  const urlModel = searchParams.get("model")

  // --- Models ---
  const [models, setModels] = useState<{ id: string; name?: string }[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.listModels()
      .then((res: any) => {
        if (cancelled) return
        const data = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []
        const list = data.map((m: any) => ({
          id: m.id || m.model || m.name,
          name: m.name || m.id || m.model,
        }))
        setModels(list)
        setModelsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setModelsLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  // --- Config ---
  const savedConfig = useRef(loadConfig())
  const [model, setModel] = useState(urlModel || savedConfig.current?.model || "")

  // --- Mode: auto-detected from model name ---
  const isImageModel = (id: string) => /^gpt-image/i.test(id)
  const mode = isImageModel(model) ? "image" : "chat"

  useEffect(() => {
    if (modelsLoaded && !model && models.length > 0) {
      setModel(models[0].id)
    }
  }, [modelsLoaded, models, model])

  useEffect(() => {
    saveConfig({ model })
  }, [model])

  // --- Chat history ---
  const [chats, setChats] = useState<Chat[]>(loadChats)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null)

  useEffect(() => {
    saveChats(chats)
  }, [chats])

  const activeChat = chats.find((c) => c.id === activeChatId) || null
  const messages = activeChat?.messages || []

  function updateChat(id: string, patch: Partial<Chat>) {
    setChats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c))
    )
  }

  function createNewChat() {
    const id = crypto.randomUUID()
    const chat: Chat = {
      id,
      title: t("chat.newChatTitle", { defaultValue: "New Chat" }),
      model,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setChats((prev) => [chat, ...prev])
    setActiveChatId(id)
  }

  function deleteChat(id: string) {
    setChats((prev) => prev.filter((c) => c.id !== id))
    if (activeChatId === id) setActiveChatId(null)
  }

  function maybeUpdateTitle(chatId: string, msgs: Message[]) {
    if (msgs.length === 1 && msgs[0].role === "user") {
      const title = msgs[0].content.slice(0, 40) + (msgs[0].content.length > 40 ? "..." : "")
      updateChat(chatId, { title })
    }
  }

  // --- File attachments ---
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const fileArray = Array.from(files)
    const newAtts: FileAttachment[] = fileArray.map((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || ""
      return {
        id: crypto.randomUUID(),
        file,
        name: file.name,
        ext,
        type: getFileType(file),
        status: "extracting",
      }
    })
    setAttachments((prev) => [...prev, ...newAtts])

    for (const att of newAtts) {
      const result = await extractFileContent(att.file, att.type)
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === att.id
            ? {
                ...a,
                ...result,
                status: result.error ? "error" : "ready",
              }
            : a
        )
      )
    }
  }, [])

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    processFiles(e.dataTransfer.files)
  }

  // --- Streaming / Sending ---
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const ensureActiveChat = useCallback(() => {
    if (!activeChatId) {
      const id = crypto.randomUUID()
      const chat: Chat = {
        id,
        title: t("chat.newChatTitle", { defaultValue: "New Chat" }),
        model,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      setChats((prev) => [chat, ...prev])
      setActiveChatId(id)
      return id
    }
    return activeChatId
  }, [activeChatId, model, t])

  const buildUserMessage = useCallback((): { content: string; imageUrls: string[] } => {
    const readyAtts = attachments.filter((a) => a.status === "ready")
    const imageUrls = readyAtts.filter((a) => a.type === "image" && a.imageUrl).map((a) => a.imageUrl!)
    const textParts: string[] = []
    if (input.trim()) textParts.push(input.trim())
    for (const att of readyAtts) {
      if (att.content) {
        textParts.push(`\n\n--- ${att.name} ---\n${att.content}`)
      }
    }
    return { content: textParts.join(""), imageUrls }
  }, [input, attachments])

  const sendMessage = useCallback(async () => {
    if ((!input.trim() && attachments.filter((a) => a.status === "ready").length === 0) || streaming) return

    const chatId = ensureActiveChat()
    const currentMessages = activeChat?.messages || []
    const { content, imageUrls } = buildUserMessage()

    if (!content.trim() && imageUrls.length === 0) return

    const userMsg: Message = {
      role: "user",
      content,
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
    }
    const newMessages = [...currentMessages, userMsg]
    updateChat(chatId, { messages: newMessages })
    maybeUpdateTitle(chatId, newMessages)
    setInput("")
    setAttachments([])
    setStreaming(true)

    const assistantMsg: Message = { role: "assistant", content: "" }
    const withAssistant = [...newMessages, assistantMsg]
    updateChat(chatId, { messages: withAssistant })

    try {
      const token = localStorage.getItem("token")
      const controller = new AbortController()
      abortRef.current = controller

      const apiMessages = [
        ...newMessages.map((m) => {
          const imgs = m.imageUrls || (m.imageUrl ? [m.imageUrl] : [])
          if (imgs.length > 0) {
            return {
              role: m.role,
              content: [
                { type: "text", text: m.content },
                ...imgs.map((url) => ({ type: "image_url", image_url: { url } })),
              ],
            }
          }
          return { role: m.role, content: m.content }
        }),
      ]

      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          temperature: model.toLowerCase().startsWith("kimi") ? 1 : 0.7,
          max_tokens: 4096,
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error?.message || `HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let fullContent = ""

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue
            const data = line.slice(6).trim()
            if (data === "[DONE]") break
            try {
              const json = JSON.parse(data)
              const delta = json.choices?.[0]?.delta?.content || ""
              fullContent += delta
              updateChat(chatId, {
                messages: [
                  ...newMessages,
                  { role: "assistant", content: fullContent },
                ],
              })
            } catch {
              /* skip */
            }
          }
        }
      }

      // Final update
      updateChat(chatId, {
        messages: [
          ...newMessages,
          { role: "assistant", content: fullContent },
        ],
      })
    } catch (err: any) {
      if (err.name !== "AbortError") {
        updateChat(chatId, {
          messages: [
            ...newMessages,
            { role: "assistant", content: `Error: ${err.message}` },
          ],
        })
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [input, attachments, activeChat, model, streaming, ensureActiveChat, buildUserMessage])

  // --- Image generation ---
  const sendImageGen = useCallback(async () => {
    if (!input.trim() || streaming) return

    const chatId = ensureActiveChat()
    const currentMessages = activeChat?.messages || []

    const userMsg: Message = { role: "user", content: input.trim() }
    const newMessages = [...currentMessages, userMsg]
    updateChat(chatId, { messages: newMessages })
    maybeUpdateTitle(chatId, newMessages)
    setInput("")
    setStreaming(true)

    const assistantMsg: Message = { role: "assistant", content: t("chat.generatingImages", { defaultValue: "Generating images..." }) }
    updateChat(chatId, { messages: [...newMessages, assistantMsg] })

    try {
      const token = localStorage.getItem("token")
      const controller = new AbortController()
      abortRef.current = controller

      const res = await fetch("/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: model,
          prompt: userMsg.content,
          n: 1,
          size: "1024x1024",
          quality: "standard",
          style: "vivid",
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error?.message || `Request failed: ${res.status}`)
      }

      const data = await res.json()
      const images: GeneratedImage[] = data.data || []

      updateChat(chatId, {
        messages: [
          ...newMessages,
          {
            role: "assistant",
            content: images[0]?.revised_prompt || userMsg.content,
            generatedImages: images,
          },
        ],
      })
    } catch (err: any) {
      if (err.name !== "AbortError") {
        updateChat(chatId, {
          messages: [
            ...newMessages,
            { role: "assistant", content: `Error: ${err.message}` },
          ],
        })
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [input, streaming, activeChat, ensureActiveChat, t])

  const handleSend = () => {
    if (mode === "image") {
      sendImageGen()
    } else {
      sendMessage()
    }
  }

  const stopStreaming = () => abortRef.current?.abort()

  // --- Message actions ---
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  function copyMessage(idx: number) {
    const msg = messages[idx]
    if (!msg) return
    navigator.clipboard.writeText(msg.content)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }

  function deleteMessage(idx: number) {
    if (!activeChatId) return
    const updated = messages.filter((_, i) => i !== idx)
    updateChat(activeChatId, { messages: updated })
  }

  function clearChat() {
    if (!activeChatId) return
    updateChat(activeChatId, { messages: [], title: t("chat.newChatTitle", { defaultValue: "New Chat" }) })
  }

  function handleDownload(url: string, index: number) {
    const a = document.createElement("a")
    a.href = url
    a.download = `generated-${index + 1}.png`
    a.target = "_blank"
    a.click()
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  function attachmentIcon(att: FileAttachment) {
    if (att.type === "image") return <FileImage className="h-3.5 w-3.5" />
    if (att.type === "excel") return <FileSpreadsheet className="h-3.5 w-3.5" />
    return <FileText className="h-3.5 w-3.5" />
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="h-[calc(100vh-7rem)] flex gap-0">
      {/* ---- Sidebar ---- */}
      {sidebarOpen && (
        <div className="w-64 border-r border-slate-200/80 bg-slate-50/50 flex flex-col shrink-0 dark:border-slate-800/60 dark:bg-slate-900/30">
          <div className="p-3 flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800/60">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {t("chat.sessions", { defaultValue: "Sessions" })}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={createNewChat}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {chats.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4 dark:text-slate-500">
                  {t("chat.noChats", { defaultValue: "No chats yet" })}
                </p>
              )}
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm cursor-pointer transition-colors",
                    activeChatId === chat.id
                      ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
                  )}
                  onClick={() => setActiveChatId(chat.id)}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                  <span className="flex-1 truncate">{chat.title}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteDialogId(chat.id)
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* ---- Main area ---- */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-2 gap-2 dark:border-slate-800/60">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <ChevronLeft
                className={cn(
                  "h-4 w-4 transition-transform",
                  !sidebarOpen && "rotate-180"
                )}
              />
            </Button>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-500/25">
                <VendorIcon name={model} size={18} />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight leading-tight dark:text-slate-100">
                  {mode === "image"
                    ? t("chat.imageModeTitle", { defaultValue: "Image Generation" })
                    : t("chat.title", { defaultValue: "Chat" })}
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {model || "Select a model"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-[200px] h-8 text-xs dark:bg-slate-800 dark:border-slate-700">
                <SelectValue placeholder={modelsLoaded ? "Select model" : "Loading..."} />
              </SelectTrigger>
              <SelectContent>
                {models.length > 0 ? (
                  models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name || m.id}
                    </SelectItem>
                  ))
                ) : (
                  <>
                    <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4</SelectItem>
                    <SelectItem value="claude-opus-4-20250514">Claude Opus 4</SelectItem>
                    <SelectItem value="gpt-5.5">GPT-5.5</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={clearChat}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("chat.clear", { defaultValue: "Clear" })}
            </Button>
          </div>
        </div>

        {/* Body: chat area with drag support */}
        <div
          className="flex-1 flex flex-col min-h-0 relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="absolute inset-0 z-50 bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-lg m-2 flex items-center justify-center">
              <div className="text-center space-y-2">
                <Plus className="h-10 w-10 text-blue-500 mx-auto" />
                <p className="text-sm font-medium text-blue-600">{t("chat.dropFiles", { defaultValue: "Drop files to upload" })}</p>
              </div>
            </div>
          )}

          <ScrollArea className="flex-1 p-4">
            {!activeChatId || messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-3 max-w-sm">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 mx-auto dark:bg-blue-500/10">
                    {mode === "image" ? (
                      <Wand2 className="h-8 w-8 text-blue-500 dark:text-blue-400" />
                    ) : (
                      <Bot className="h-8 w-8 text-blue-500 dark:text-blue-400" />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {mode === "image"
                      ? t("chat.imageWelcomeTitle", { defaultValue: "What would you like to create?" })
                      : t("chat.welcomeTitle", { defaultValue: "How can I help you today?" })}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {mode === "image"
                      ? t("chat.imageWelcomeDesc", { defaultValue: "Describe the image you want to generate." })
                      : t("chat.welcomeDesc", { defaultValue: "Select a model and start typing. Your conversations are saved locally." })}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl mx-auto">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={cn(
                      "group flex gap-2.5",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {/* Avatar */}
                    {msg.role === "assistant" && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/10">
                        <VendorIcon name={activeChat?.model || model} size={20} />
                      </div>
                    )}

                    {/* Bubble */}
                    <div
                      className={cn(
                        "relative max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm",
                        msg.role === "user"
                          ? "bg-blue-600 text-white shadow-md shadow-blue-500/10"
                          : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                      )}
                    >
                      {msg.role === "assistant" ? (
                        <div
                          className="prose-sm prose-zinc max-w-none break-words dark:prose-invert
                            [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:text-xs
                            [&_code:not(pre_code)]:bg-slate-200 [&_code:not(pre_code)]:dark:bg-slate-700 [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:text-xs [&_code:not(pre_code)]:font-mono"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      )}

                      {/* Generated images */}
                      {msg.generatedImages && msg.generatedImages.length > 0 && (
                        <div className={msg.content ? "mt-2" : ""}>
                          <div className="grid grid-cols-1 gap-1.5">
                            {msg.generatedImages.map((img, idx) => (
                              <ImageBlock key={idx} img={img} idx={idx} onDownload={handleDownload} />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Actions float over the bubble so hidden controls do not reserve space. */}
                      {msg.role === "assistant" && (
                        <div className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-lg bg-slate-100/95 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 dark:bg-slate-800/95">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => copyMessage(i)}
                          >
                            {copiedIdx === i ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => deleteMessage(i)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {msg.role === "user" && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-700">
                        <UserCircle className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </ScrollArea>

          {/* Input bar */}
          <div className="border-t border-slate-200/80 p-4 bg-white/50 dark:border-slate-800/60 dark:bg-transparent">
            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 max-w-3xl mx-auto">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs border transition-colors",
                      att.status === "error"
                        ? "bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:border-red-800/60 dark:text-red-400"
                        : att.status === "extracting"
                        ? "bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400"
                        : "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-500/10 dark:border-blue-800/60 dark:text-blue-400"
                    )}
                  >
                    {att.status === "extracting" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      attachmentIcon(att)
                    )}
                    <span className="max-w-[120px] truncate">{att.name}</span>
                    {att.status === "ready" && att.content && (
                      <span className="text-[10px] opacity-70">({att.content.length.toLocaleString()})</span>
                    )}
                    {att.status === "error" && att.error && (
                      <span className="text-[10px] opacity-70">{att.error}</span>
                    )}
                    <button
                      onClick={() => removeAttachment(att.id)}
                      className="ml-0.5 hover:opacity-70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 max-w-3xl mx-auto">
              <input
                type="file"
                multiple
                ref={fileInputRef}
                className="hidden"
                onChange={(e) => {
                  processFiles(e.target.files)
                  e.target.value = ""
                }}
                accept=".txt,.md,.js,.ts,.jsx,.tsx,.py,.json,.csv,.html,.css,.xml,.yaml,.yml,.sql,.c,.cpp,.go,.java,.rs,.php,.rb,.pdf,.xlsx,.xls,image/*"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={() => fileInputRef.current?.click()}
                title={t("chat.addFiles", { defaultValue: "Add files" })}
                disabled={streaming}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  mode === "image"
                    ? t("chat.imagePlaceholder", { defaultValue: "Describe the image you want to generate..." })
                    : t("chat.placeholder", { defaultValue: "Type your message..." })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                disabled={streaming}
                className="flex-1 h-10 rounded-xl dark:bg-slate-800 dark:border-slate-700"
              />
              {streaming ? (
                <Button onClick={stopStreaming} variant="destructive" size="icon" className="h-10 w-10 rounded-xl">
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleSend}
                  disabled={(!input.trim() && attachments.filter((a) => a.status === "ready").length === 0) || !model}
                  size="icon"
                  className="h-10 w-10 rounded-xl"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Delete chat confirmation dialog ---- */}
      <Dialog
        open={deleteDialogId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogId(null)
        }}
      >
        <DialogContent className="sm:max-w-sm dark:bg-[#0f172a] dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="dark:text-slate-100">
              {t("chat.deleteChatTitle")}
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              {t("chat.deleteChatConfirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogId(null)} className="dark:border-slate-700 dark:text-slate-300">
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteDialogId) deleteChat(deleteDialogId)
                setDeleteDialogId(null)
              }}
            >
              {t("common.delete", { defaultValue: "Delete" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
