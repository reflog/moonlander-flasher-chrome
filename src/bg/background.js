chrome.extension.onMessage.addListener(function (
  request,
  sender,
  sendResponse
) {
  console.log("re", request);
  if (request.title == "download") {
    fetch(request.dlUrl, {
      headers: {
        "Content-Type": "application/octet-stream",
      },
      redirect: "follow",
    })
      .then((res) => {
        console.log(res);
        return res.arrayBuffer();
      }) // Gets the response and returns it as a blob
      .then((ab) => {
        sendResponse(
          JSON.stringify({ data: Array.apply(null, new Uint8Array(ab)) })
        );
      });
    return true;
  } else {
    sendResponse();
  }
});
