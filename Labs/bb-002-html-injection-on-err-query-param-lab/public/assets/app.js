(() => {
  const params = new URLSearchParams(window.location.search);
  const rawMessage = params.get("error") || params.get("message");
  const messageBox = document.getElementById("messageBox");

  if (!rawMessage || !messageBox) {
    return;
  }

  messageBox.hidden = false;
  renderMessage(messageBox, rawMessage);

  function renderMessage(target, value) {
    target.innerHTML = value;

    const scripts = Array.from(target.querySelectorAll("script"));

    for (const oldScript of scripts) {
      const newScript = document.createElement("script");

      for (const attribute of oldScript.attributes) {
        newScript.setAttribute(attribute.name, attribute.value);
      }

      newScript.text = oldScript.textContent;
      oldScript.replaceWith(newScript);
    }
  }
})();
