"""LiteLLM singleton — one place to swap models / providers.

Usage:
    from app.services.llm_client import llm
    reply = await llm.complete([{"role": "user", "content": "hello"}])

    async for chunk in llm.stream([...]):
        print(chunk, end="")

Model selection is driven by settings.LLM_MODEL. Because LiteLLM speaks the
OpenAI-compatible protocol, switching from Anthropic → OpenAI → Gemini only
requires changing the env var — no code change.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterable

import litellm

from app.core.config import settings

# Disable LiteLLM's default logging noise; we handle errors explicitly.
litellm.drop_params = True
litellm.telemetry = False


class LLMClient:
    def __init__(self) -> None:
        self.model = settings.LLM_MODEL
        self.api_base = settings.LLM_BASE_URL or None
        self.api_key = settings.LLM_API_KEY or None
        self.max_tokens = settings.LLM_MAX_TOKENS
        self.temperature = settings.LLM_TEMPERATURE

    def _common_kwargs(self, **overrides) -> dict:
        kw = {
            "model": overrides.get("model", self.model),
            "temperature": overrides.get("temperature", self.temperature),
            "max_tokens": overrides.get("max_tokens", self.max_tokens),
        }
        if self.api_base:
            kw["api_base"] = self.api_base
        if self.api_key:
            kw["api_key"] = self.api_key
        return kw

    async def complete(
        self,
        messages: Iterable[dict],
        **overrides,
    ) -> str:
        """Non-streaming completion. Returns concatenated assistant text."""
        resp = await litellm.acompletion(
            messages=list(messages),
            stream=False,
            **self._common_kwargs(**overrides),
        )
        return resp.choices[0].message.content or ""

    async def stream(
        self,
        messages: Iterable[dict],
        **overrides,
    ) -> AsyncIterator[str]:
        """Streaming completion. Yields content deltas as they arrive."""
        stream = await litellm.acompletion(
            messages=list(messages),
            stream=True,
            **self._common_kwargs(**overrides),
        )
        async for chunk in stream:
            delta = getattr(chunk.choices[0].delta, "content", None)
            if delta:
                yield delta

    async def complete_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        **overrides,
    ):
        """Non-streaming completion with tool definitions.

        Returns the raw ``choices[0].message`` object from LiteLLM, which
        exposes ``.content`` (str | None) and ``.tool_calls`` (list | None).
        """
        resp = await litellm.acompletion(
            messages=messages,
            tools=tools,
            tool_choice="auto",
            stream=False,
            **self._common_kwargs(**overrides),
        )
        return resp.choices[0].message


# Module-level singleton — cheap, thread-safe because litellm is stateless.
llm = LLMClient()
