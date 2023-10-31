export const Login: preact.FunctionComponent = () => (
  <form
    hx-post="/login/session"
    hx-swap="outerHTML"
    hx-trigger="submit throttle:30s"
    hx-target="#content"
  >
    <input type="submit" name="authorize" value="Login" />
  </form>
);
