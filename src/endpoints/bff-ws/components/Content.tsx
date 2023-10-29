export const Content: preact.FunctionalComponent<{ oob?: boolean }> = ({
  children,
  oob = true,
}) => (
  <div id="content" {...(oob ? { 'hx-swap-oob': 'true' } : {})}>
    {children}
  </div>
);
