export const Content: preact.FunctionalComponent<{ className?: string }> = ({
  className,
  children,
}) => (
  <div id="content" hx-target="#content" className={className}>
    {children}
  </div>
);
