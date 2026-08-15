import { ArrowReloadHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { ReasoningEffortSlider } from "@/components/chat/reasoning-effort-slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";

const numberFormatter = new Intl.NumberFormat();
const EXPECTED_CONTEXT_LENGTH = 131072;
export const REASONING_LEVELS = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "XHigh", value: "xhigh" },
];

function SettingSection({ children, title }) {
  return (
    <section className="space-y-4">
      <h3 className="text-title-sm text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function SliderSetting({
  formatValue = String,
  label,
  max,
  min,
  onChange,
  step,
  value,
}) {
  return (
    <label className="grid gap-2.5">
      <span className="flex items-center justify-between gap-4 text-label-md">
        <span>{label}</span>
        <output className="type-numeric font-mono text-body-sm text-muted-foreground">
          {formatValue(value)}
        </output>
      </span>
      <Slider
        aria-label={label}
        max={max}
        min={min}
        step={step}
        value={[value]}
        onValueChange={([nextValue]) => onChange(nextValue)}
      />
    </label>
  );
}

function ReasoningEffortSetting({ id, onChange, value }) {
  const selectedIndex = Math.max(
    0,
    REASONING_LEVELS.findIndex((level) => level.value === value),
  );
  const selectedLevel = REASONING_LEVELS[selectedIndex];

  return (
    <div className="grid gap-2.5">
      <span className="flex items-center justify-between gap-4 text-label-md">
        <span id={`${id}-label`}>Reasoning effort</span>
        <output className="font-mono text-body-sm text-muted-foreground">
          {selectedLevel.label}
        </output>
      </span>
      <ReasoningEffortSlider
        id={id}
        labelledBy={`${id}-label`}
        levels={REASONING_LEVELS}
        selectedIndex={selectedIndex}
        onValueChange={(nextIndex) =>
          onChange(REASONING_LEVELS[nextIndex]?.value ?? "high")
        }
      />
    </div>
  );
}

function RuntimeRow({ label, title, value }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 text-body-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-mono" title={title ?? value}>
        {value || "—"}
      </dd>
    </div>
  );
}

export function PlaygroundSettings({
  headerAction,
  idPrefix,
  onReset,
  onSettingChange,
  onSystemPromptChange,
  runtime,
  settings,
  systemPrompt,
}) {
  const contextLength = Number(runtime?.contextLength) || 0;
  const maxTokenLimit = contextLength || EXPECTED_CONTEXT_LENGTH;
  const formattedMaxTokenLimit = numberFormatter.format(maxTokenLimit);
  const maxImageBytes = Number(runtime?.maxImageBytes) || 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-title-lg">Playground</h2>
          <p className="text-body-sm text-muted-foreground">
            Generation and runtime
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            aria-label="Reset generation settings"
            size="icon-sm"
            variant="ghost"
            onClick={onReset}
          >
            <HugeiconsIcon icon={ArrowReloadHorizontalIcon} strokeWidth={2} />
          </Button>
          {headerAction}
        </div>
      </div>

      <Separator />

      <div className="scrollbar-thin min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 overscroll-contain">
        <SettingSection title="Prompt">
          <label className="grid gap-2" htmlFor={`${idPrefix}-system-prompt`}>
            <span className="text-label-md">System message</span>
            <Textarea
              id={`${idPrefix}-system-prompt`}
              className="min-h-24 text-base md:text-body-md"
              placeholder="Optional"
              value={systemPrompt}
              onChange={(event) => onSystemPromptChange(event.target.value)}
            />
          </label>

          <ReasoningEffortSetting
            id={`${idPrefix}-reasoning-effort`}
            value={settings.reasoningStrength}
            onChange={(value) => onSettingChange("reasoningStrength", value)}
          />
        </SettingSection>

        <Separator />

        <SettingSection title="Sampling">
          <SliderSetting
            label="Temperature"
            min={0}
            max={2}
            step={0.05}
            value={settings.temperature}
            formatValue={(value) => value.toFixed(2)}
            onChange={(value) => onSettingChange("temperature", value)}
          />
          <SliderSetting
            label="Top P"
            min={0.01}
            max={1}
            step={0.01}
            value={settings.topP}
            formatValue={(value) => value.toFixed(2)}
            onChange={(value) => onSettingChange("topP", value)}
          />

          <div className="grid grid-cols-[2fr_3fr] gap-3">
            <label className="grid gap-2" htmlFor={`${idPrefix}-top-k`}>
              <span className="text-label-md">Top K</span>
              <Input
                id={`${idPrefix}-top-k`}
                className="font-mono"
                inputMode="numeric"
                min={1}
                max={512}
                type="number"
                value={settings.topK}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) {
                    onSettingChange("topK", Math.max(1, Math.min(512, value)));
                  }
                }}
              />
            </label>

            <div className="grid gap-2">
              <label
                className="text-label-md"
                htmlFor={`${idPrefix}-max-tokens`}
              >
                Max output
              </label>
              <InputGroup>
                <InputGroupInput
                  id={`${idPrefix}-max-tokens`}
                  className="font-mono"
                  inputMode="numeric"
                  min={1}
                  max={maxTokenLimit}
                  type="number"
                  value={settings.maxTokens}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) {
                      onSettingChange(
                        "maxTokens",
                        Math.max(1, Math.min(maxTokenLimit, value)),
                      );
                    }
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    aria-label={`Set Max output to ${formattedMaxTokenLimit}`}
                    title={`Use the full ${formattedMaxTokenLimit}-token context limit`}
                    onClick={() => onSettingChange("maxTokens", maxTokenLimit)}
                  >
                    Max
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </div>
          <p className="text-body-sm text-muted-foreground">
            Prompt and output share the {formattedMaxTokenLimit}-token context.
          </p>
        </SettingSection>

        <Separator />

        <SettingSection title="Runtime">
          <dl className="space-y-2.5">
            <RuntimeRow label="Model" value={runtime?.model} />
            <RuntimeRow label="Backend" value={runtime?.backend} />
            <RuntimeRow label="Device" value={runtime?.device} />
            <RuntimeRow
              label="Context"
              value={
                contextLength ? numberFormatter.format(contextLength) : "—"
              }
            />
            <RuntimeRow
              label="Vision"
              value={runtime?.supports?.vision ? "Available" : "Unavailable"}
            />
            <RuntimeRow
              label="Warm resume"
              value={
                runtime?.supports?.warmResume ? "Available" : "Unavailable"
              }
            />
            <RuntimeRow
              label="Image limit"
              value={
                maxImageBytes
                  ? `${(maxImageBytes / 1024 / 1024).toFixed(1)} MB`
                  : "—"
              }
            />
            <RuntimeRow
              label="Artifact"
              title={runtime?.artifact}
              value={runtime?.artifact}
            />
          </dl>
        </SettingSection>
      </div>
    </div>
  );
}
