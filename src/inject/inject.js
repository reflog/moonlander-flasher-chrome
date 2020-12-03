chrome.extension.sendMessage({ title: "start" }, function (response) {
  let a;
  var readyStateCheckInterval = setInterval(function () {
    a = document.querySelector("a[href^='http']");
    if (a) {
      clearInterval(readyStateCheckInterval);
      let b = a.cloneNode();
      b.innerText = "Flash";
      a.after(b);
      const dlUrl = b.href;
      b.removeAttribute("href");
      b.addEventListener("click", function (e) {
        console.log("woo!", dlUrl);

        chrome.extension.sendMessage(
          { title: "download", dlUrl },
          function (re) {
            const rd = JSON.parse(re);
            window.doTheStuff(new Uint8Array(rd.data).buffer);
          }
        );
      });
    }
  }, 10);
});
