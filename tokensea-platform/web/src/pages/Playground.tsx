import { useState, useRef, useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Separator } from "@/components/ui/separator"
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
  ImageIcon,
  ChevronLeft,
  Settings2,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  role: "system" | "user" | "assistant"
  content: string
  imageUrl?: string
}

interface Chat {
  id: string
  title: string
  model: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const STORAGE_CHATS = "playground_chats"
const STORAGE_CONFIG = "playground_config"

interface PlaygroundConfig {
  model: string
  temperature: number
  maxTokens: number
  systemPrompt: string
}

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

function loadConfig(): PlaygroundConfig | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CONFIG) || "null")
  } catch {
    return null
  }
}

function saveConfig(cfg: PlaygroundConfig) {
  localStorage.setItem(STORAGE_CONFIG, JSON.stringify(cfg))
}

// ---------------------------------------------------------------------------
// Simple markdown renderer (no external deps)
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): string {
  let html = text

  // Escape HTML first
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

  // Fenced code blocks: ```lang\n...\n```
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang: string, code: string) =>
      `<pre class="bg-zinc-900 text-zinc-100 rounded-md p-3 my-2 overflow-x-auto text-xs"><code${
        lang ? ` class="language-${lang}"` : ""
      }>${code}</code></pre>`
  )

  // Inline code: `...`
  html = html.replace(
    /`([^`\n]+)`/g,
    '<code class="bg-zinc-200 dark:bg-zinc-700 px-1 py-0.5 rounded text-xs font-mono">$1</code>'
  )

  // Bold: **...** or __...__
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>")

  // Italic: *...* or _..._
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
  html = html.replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>")

  // Headings: ###, ##, #
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-3 mb-1">$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-3 mb-1">$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold mt-3 mb-1">$1</h1>')

  // Unordered lists: lines starting with - or *
  html = html.replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')

  // Ordered lists: lines starting with 1. 2. etc
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')

  // Paragraphs: double newlines
  html = html.replace(/\n{2,}/g, "</p><p>")

  // Single newlines -> <br>
  html = html.replace(/\n/g, "<br />")

  // Wrap in paragraph if not already wrapped by block elements
  if (!html.startsWith("<")) {
    html = `<p>${html}</p>`
  }

  return html
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlaygroundPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()

  // --- JWT for Playground relay (backend resolves JWT → user's active API key) ---
  const jwt = localStorage.getItem("token")

  // --- Models from API ---
  const [models, setModels] = useState<{ id: string; name?: string }[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .listModels()
      .then((res: any) => {
        if (cancelled) return
        const data = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []
        setModels(
          data.map((m: any) => ({
            id: m.id || m.model || m.name,
            name: m.name || m.id || m.model,
          }))
        )
        setModelsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setModelsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // --- Config (auto-save) ---
  const savedConfig = useRef(loadConfig())
  const [model, setModel] = useState(searchParams.get("model") || savedConfig.current?.model || "")
  const [systemPrompt, setSystemPrompt] = useState(savedConfig.current?.systemPrompt || "")
  const [temperature, setTemperature] = useState(savedConfig.current?.temperature ?? 0.7)
  const [maxTokens, setMaxTokens] = useState(savedConfig.current?.maxTokens ?? 4096)

  // Set default model once models are loaded
  useEffect(() => {
    if (modelsLoaded && !model && models.length > 0) {
      setModel(models[0].id)
    }
  }, [modelsLoaded, models, model])

  // Auto-save config whenever it changes
  useEffect(() => {
    saveConfig({ model, temperature, maxTokens, systemPrompt })
  }, [model, temperature, maxTokens, systemPrompt])

  // --- Chat history ---
  const [chats, setChats] = useState<Chat[]>(loadChats)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null)

  // Persist chats whenever they change
  useEffect(() => {
    saveChats(chats)
  }, [chats])

  // Active chat helpers
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
      title: t("playground.newChat", { defaultValue: "New Chat" }),
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
    if (activeChatId === id) {
      setActiveChatId(null)
    }
  }

  // Auto-title from first user message
  function maybeUpdateTitle(chatId: string, msgs: Message[]) {
    if (msgs.length === 1 && msgs[0].role === "user") {
      const title = msgs[0].content.slice(0, 40) + (msgs[0].content.length > 40 ? "..." : "")
      updateChat(chatId, { title })
    }
  }

  // --- Streaming ---
  const [input, setInput] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [showImageUrl, setShowImageUrl] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new content
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming) return
    if (!activeChatId) {
      createNewChat()
      // Will be called again after chat is created; for now return
      return
    }

    const userMsg: Message = {
      role: "user",
      content: input.trim(),
      ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
    }
    const newMessages = [...messages, userMsg]
    updateChat(activeChatId, { messages: newMessages })
    maybeUpdateTitle(activeChatId, newMessages)
    setInput("")
    setImageUrl("")
    setStreaming(true)

    const assistantMsg: Message = { role: "assistant", content: "" }
    const withAssistant = [...newMessages, assistantMsg]
    updateChat(activeChatId, { messages: withAssistant })

    try {
      if (!jwt) throw new Error("Please log in to use the Playground")
      const controller = new AbortController()
      abortRef.current = controller

      const apiMessages = [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        ...newMessages.map((m) => {
          if (m.imageUrl) {
            return {
              role: m.role,
              content: [
                { type: "text", text: m.content },
                { type: "image_url", image_url: { url: m.imageUrl } },
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
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          temperature,
          max_tokens: maxTokens,
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
              updateChat(activeChatId, {
                messages: [
                  ...newMessages,
                  { role: "assistant", content: fullContent },
                ],
              })
            } catch {
              /* skip parse errors */
            }
          }
        }
      }

      // Final update
      updateChat(activeChatId, {
        messages: [
          ...newMessages,
          { role: "assistant", content: fullContent },
        ],
      })
    } catch (err: any) {
      if (err.name !== "AbortError") {
        updateChat(activeChatId, {
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
  }, [input, imageUrl, messages, model, systemPrompt, temperature, maxTokens, streaming, activeChatId, jwt])

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

  // --- Clear current chat ---
  function clearChat() {
    if (!activeChatId) return
    updateChat(activeChatId, { messages: [], title: t("playground.newChat", { defaultValue: "New Chat" }) })
    setSystemPrompt("")
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-0">
      {/* ---- Sidebar ---- */}
      {sidebarOpen && (
        <div className="w-64 border-r bg-muted/30 flex flex-col shrink-0">
          <div className="p-3 flex items-center justify-between border-b">
            <span className="text-sm font-semibold">
              {t("playground.chats", { defaultValue: "Chats" })}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={createNewChat}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {chats.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  {t("playground.noChats", { defaultValue: "No chats yet" })}
                </p>
              )}
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted transition-colors",
                    activeChatId === chat.id && "bg-muted font-medium"
                  )}
                  onClick={() => setActiveChatId(chat.id)}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
        <div className="flex items-center justify-between border-b px-4 py-2 gap-2">
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
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-tight">
                {t("playground.title", { defaultValue: "Playground" })}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t("playground.subtitle", { defaultValue: "Test your models" })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-[200px] h-8 text-xs">
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
                    <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                    <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={clearChat}>
              <Trash2 className="h-3.5 w-3.5" />
              {t("playground.clear", { defaultValue: "Clear" })}
            </Button>
          </div>
        </div>

        {/* Body: chat + settings */}
        <div className="flex-1 flex min-h-0">
          {/* Chat area */}
          <div className="flex-1 flex flex-col min-h-0">
            <ScrollArea className="flex-1 p-4">
              {!activeChatId || messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  <div className="text-center space-y-2">
                    <MessageSquare className="h-10 w-10 mx-auto opacity-30" />
                    <p>
                      {activeChatId
                        ? t("playground.noResponse", { defaultValue: "Send a message to start" })
                        : t("playground.selectOrCreate", {
                            defaultValue: "Select or create a chat to begin",
                          })}
                    </p>
                    {!activeChatId && (
                      <Button variant="outline" size="sm" onClick={createNewChat}>
                        <Plus className="h-4 w-4 mr-1" />
                        {t("playground.newChat", { defaultValue: "New Chat" })}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={cn(
                        "group flex gap-2",
                        msg.role === "user" ? "justify-end" : "justify-start"
                      )}
                    >
                      {msg.role === "assistant" && (
                        <div className="shrink-0 mt-1">
                          <VendorIcon name={activeChat?.model || model} size={24} />
                        </div>
                      )}
                      <div
                        className={cn(
                          "relative max-w-[80%] rounded-lg px-4 py-2 text-sm",
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        )}
                      >
                        {/* Image indicator */}
                        {msg.imageUrl && (
                          <div className="mb-1 flex items-center gap-1 text-xs opacity-70">
                            <ImageIcon className="h-3 w-3" />
                            <span className="truncate max-w-[200px]">{msg.imageUrl}</span>
                          </div>
                        )}

                        {/* Message content */}
                        {msg.role === "assistant" ? (
                          <div
                            className="prose-sm prose-zinc dark:prose-invert max-w-none break-words [&_pre]:bg-zinc-900 [&_pre]:text-zinc-100 [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:text-xs [&_code:not(pre_code)]:bg-zinc-200 [&_code:not(pre_code)]:dark:bg-zinc-700 [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:text-xs [&_code:not(pre_code)]:font-mono"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdown(msg.content),
                            }}
                          />
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        )}

                        {/* Message actions */}
                        <div className="absolute -bottom-5 right-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => copyMessage(i)}
                            title={t("playground.copy", { defaultValue: "Copy" })}
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
                            className="h-5 w-5"
                            onClick={() => deleteMessage(i)}
                            title={t("playground.deleteMessage", { defaultValue: "Delete" })}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Input bar */}
            <div className="border-t p-4 space-y-2">
              {/* Image URL row (toggle) */}
              {showImageUrl && (
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder={t("playground.imageUrlPlaceholder", {
                      defaultValue: "Image URL (optional)",
                    })}
                    className="h-8 text-xs"
                    disabled={streaming}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => {
                      setShowImageUrl(false)
                      setImageUrl("")
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => setShowImageUrl(!showImageUrl)}
                  title={t("playground.addImage", { defaultValue: "Add image URL" })}
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t("playground.userMessagePlaceholder", {
                    defaultValue: "Type your message...",
                  })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  disabled={streaming || !activeChatId}
                  className="flex-1"
                />
                {streaming ? (
                  <Button onClick={stopStreaming} variant="destructive" size="icon">
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={sendMessage}
                    disabled={!input.trim() || !activeChatId}
                    size="icon"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Settings panel */}
          <Card className="w-64 hidden lg:flex flex-col rounded-none border-y-0 border-r-0">
            <div className="p-3 border-b flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">
                {t("playground.settings", { defaultValue: "Settings" })}
              </span>
            </div>
            <CardContent className="p-4 space-y-4 flex-1 overflow-y-auto">
              <div className="space-y-2">
                <Label className="text-xs">
                  {t("playground.systemPrompt", { defaultValue: "System Prompt" })}
                </Label>
                <Input
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={t("playground.systemPromptPlaceholder", {
                    defaultValue: "You are a helpful assistant...",
                  })}
                />
              </div>
              <Separator />
              <div className="space-y-2">
                <Label className="text-xs">
                  {t("playground.temperature", { defaultValue: "Temperature" })}: {temperature}
                </Label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">
                  {t("playground.maxTokens", { defaultValue: "Max Tokens" })}
                </Label>
                <Input
                  type="number"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  min={1}
                  max={128000}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ---- Delete chat confirmation dialog ---- */}
      <Dialog
        open={deleteDialogId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogId(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("playground.deleteChatTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("playground.deleteChatConfirm")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogId(null)}>
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
