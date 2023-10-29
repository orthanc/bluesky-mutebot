import { render } from 'preact-render-to-string';
import { Content } from './Content';

export const EstablishingSession = () => {
  return <>Establishing Session.....</>;
};

export const renderEstablishingSession = (oob: boolean) =>
  render(
    <Content oob={oob}>
      <div ws-connect={`wss://${process.env.WEBSOCKET_HOSTNAME}`}>
        <div id="bleet-to-authorize">
          <EstablishingSession />
          <form
            id="load-bleet-form"
            ws-send
            hx-trigger="mutebot:load-bleet from:body"
          >
            <input type="hidden" name="loadBleetToAuthorize" value="true" />
          </form>
        </div>
        <form
          hx-post={`https://${process.env.PUBLIC_HOSTNAME}/console/session/poll-authorised`}
          hx-swap="outerHTML"
          hx-trigger="every 10s"
          hx-target="#content"
        ></form>
        <form id="ping-form" ws-send hx-trigger="mutebot:ping from:body">
          <input type="hidden" name="ensureConnectionId" value="true" />
        </form>
      </div>
    </Content>
  );
