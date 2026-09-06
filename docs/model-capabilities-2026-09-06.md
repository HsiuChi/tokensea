# Marketplace capability review

Category is retained as the relay/price interface type. Public marketplace filtering derives multiple discovery categories: text-output models with image input appear in both text and vision. Image/video generators accepting reference images are not labeled vision-understanding or cross-listed as static image generation without an integrated image output endpoint.

Exact vision IDs reviewed: gpt-6-astra, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5; kimi-k3, kimi-k2.6, kimi-k2.7-code, kimi-k2.7-code-highspeed; glm-5.3-flash; mimo-v2.5. The reviewed registry corrects legacy default-false public metadata without a financial/database migration. KSP reimport also uses these defaults. Unlisted models retain explicit database flags; there is no family-prefix assumption.

Primary sources:
- https://developers.openai.com/api/docs/models/gpt-5.6-sol (and exact Astra/Terra/Luna/5.5 model pages): image input, text output. Image-generation tool support is not a native image-output endpoint.
- https://github.com/MoonshotAI/Kimi-K3
- https://platform.kimi.ai/docs/guide/use-kimi-vision-model
- https://www.kimi.com/code/docs/en/kimi-code/models.html
- https://huggingface.co/zai-org/GLM-5.3-Flash
- https://huggingface.co/XiaomiMiMo/MiMo-V2.5
- https://huggingface.co/XiaomiMiMo/MiMo-V2.5-Pro (text-only model card, not inferred from non-Pro)

No new image-generation model is provisioned by this classification fix. Current video adapters only expose video-generation paths. No paid live model call was required for metadata validation.

Language: first visit defaults to Chinese regardless of browser locale. Explicitly stored language selections remain respected. Complete Chat image-mode translations replace fallback English. Language buttons now display the current language instead of the switch target.
