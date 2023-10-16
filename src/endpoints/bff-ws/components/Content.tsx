export const Content: preact.FunctionalComponent = ({ children }) => (
  <div id="content" hx-swap-oob="true">
    {children}
  </div>
);
