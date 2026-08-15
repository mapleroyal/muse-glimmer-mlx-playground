import * as React from "react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

function nodeText(node) {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(nodeText).join("");
  }

  if (React.isValidElement(node)) {
    return nodeText(node.props.children);
  }

  return "";
}

function CodeBlock({ children, ...props }) {
  const [copied, setCopied] = React.useState(false);
  const copiedTimerRef = React.useRef(null);

  React.useEffect(
    () => () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(
        nodeText(children).replace(/\n$/, ""),
      );
      setCopied(true);
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Unable to copy code.");
    }
  };

  return (
    <div className="chat-code-block group/code">
      <Button
        type="button"
        aria-label={copied ? "Code copied" : "Copy code"}
        className="chat-code-copy"
        size="icon-xs"
        variant="ghost"
        onClick={() => void copyCode()}
      >
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
        />
      </Button>
      <pre {...props}>{children}</pre>
    </div>
  );
}

export function MarkdownContent({ children }) {
  return (
    <div className="chat-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ node: _node, ...props }) {
            return <a target="_blank" rel="noreferrer" {...props} />;
          },
          img({ node: _node, alt }) {
            return alt ? <span>[Image: {alt}]</span> : null;
          },
          pre({ node: _node, ...props }) {
            return <CodeBlock {...props} />;
          },
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
