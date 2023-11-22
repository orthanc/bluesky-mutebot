export const Content: preact.FunctionalComponent = ({ children }) => (
  <div id="content" hx-target="#content">
    {children}
  </div>
);
