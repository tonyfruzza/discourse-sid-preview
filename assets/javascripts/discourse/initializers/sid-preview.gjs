import { apiInitializer } from "discourse/lib/api";
import SidPlayerComponent from "../components/sid-player";

const SidPlayerShim = <template>
  <SidPlayerComponent @url={{@data.url}} @filename={{@data.filename}} />
</template>;

function isSidUrl(href) {
  if (!href) return false;
  try {
    const url = new URL(href, window.location.origin);
    return url.pathname.toLowerCase().endsWith(".sid");
  } catch {
    return false;
  }
}

export default apiInitializer("1.6.0", (api) => {
  const siteSettings = api.container.lookup("service:site-settings");
  if (!siteSettings.sid_preview_enabled) return;

  api.decorateCookedElement(
    (element, helper) => {
      if (!helper) return;

      const allLinks = element.querySelectorAll("a[href]");
      allLinks.forEach((link) => {
        if (!isSidUrl(link.href)) return;
        if (link.dataset.sidPlayerAttached) return;
        link.dataset.sidPlayerAttached = "true";

        // Create container for the player below the link
        const container = document.createElement("div");
        container.className = "sid-player-container";

        const parent = link.parentElement;
        if (parent && parent.tagName === "P") {
          parent.insertAdjacentElement("afterend", container);
        } else {
          link.insertAdjacentElement("afterend", container);
        }

        const filename = link.textContent.trim() || link.href.split("/").pop();
        helper.renderGlimmer(container, SidPlayerShim, { url: link.href, filename });
      });
    },
    { id: "discourse-sid-preview", onlyStream: true }
  );
});
