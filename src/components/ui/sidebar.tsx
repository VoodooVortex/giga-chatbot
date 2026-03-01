import * as React from "react"

export const SidebarProvider = ({ children }: { children: React.ReactNode }) => (
  <div className="flex w-full h-full">{children}</div>
)

export const Sidebar = ({ children, className }: { children: React.ReactNode, className?: string, side?: string, variant?: string }) => (
  <div className={`flex flex-col h-full bg-white z-20 ${className || ""}`}>{children}</div>
)

export const SidebarHeader = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={`flex-none ${className || ""}`}>{children}</div>
)

export const SidebarContent = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={`flex-1 overflow-auto ${className || ""}`}>{children}</div>
)

export const SidebarGroup = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={`flex flex-col ${className || ""}`}>{children}</div>
)

export const SidebarGroupLabel = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={`${className || ""}`}>{children}</div>
)

export const SidebarGroupContent = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={`${className || ""}`}>{children}</div>
)

export const SidebarMenu = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={`flex flex-col gap-1 ${className || ""}`}>{children}</div>
)

export const SidebarMenuItem = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={`${className || ""}`}>{children}</div>
)

export const SidebarMenuButton = React.forwardRef<HTMLButtonElement | HTMLAnchorElement, { children: React.ReactNode, className?: string, asChild?: boolean }>((props, ref) => {
  const { asChild, className, children, ...rest } = props;
  const mergedClassName = `w-full px-4 rounded-md outline-none transition-colors ${className || ""}`;

  if (asChild && React.isValidElement(children)) {
    const childElement = children as React.ReactElement<Record<string, unknown>>;
    const childDefaultProps = childElement.props;
    const ChildNode = childElement.type as React.ComponentType<Record<string, unknown>>;
    return <ChildNode {...childDefaultProps} {...rest} ref={ref} className={`${(childDefaultProps.className as string) || ""} ${mergedClassName}`}>{childDefaultProps.children as React.ReactNode}</ChildNode>;
  }
  return (
    <button ref={ref as React.Ref<HTMLButtonElement>} className={mergedClassName} {...rest}>
      {children}
    </button>
  )
})
SidebarMenuButton.displayName = "SidebarMenuButton"

export const SidebarTrigger = () => <div />
