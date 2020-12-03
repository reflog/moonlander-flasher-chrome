var device = null;
var maxReadSize = null;

function hex4(n) {
  let s = n.toString(16);
  while (s.length < 4) {
    s = "0" + s;
  }
  return s;
}

function hexAddr8(n) {
  let s = n.toString(16);
  while (s.length < 8) {
    s = "0" + s;
  }
  return "0x" + s;
}

function niceSize(n) {
  const gigabyte = 1024 * 1024 * 1024;
  const megabyte = 1024 * 1024;
  const kilobyte = 1024;
  if (n >= gigabyte) {
    return n / gigabyte + "GiB";
  } else if (n >= megabyte) {
    return n / megabyte + "MiB";
  } else if (n >= kilobyte) {
    return n / kilobyte + "KiB";
  } else {
    return n + "B";
  }
}

function formatDFUSummary(device) {
  const vid = hex4(device.device_.vendorId);
  const pid = hex4(device.device_.productId);
  const name = device.device_.productName;

  let mode = "Unknown";
  if (device.settings.alternate.interfaceProtocol == 0x01) {
    mode = "Runtime";
  } else if (device.settings.alternate.interfaceProtocol == 0x02) {
    mode = "DFU";
  }

  const cfg = device.settings.configuration.configurationValue;
  const intf = device.settings["interface"].interfaceNumber;
  const alt = device.settings.alternate.alternateSetting;
  const serial = device.device_.serialNumber;
  let info = `${mode}: [${vid}:${pid}] cfg=${cfg}, intf=${intf}, alt=${alt}, name="${name}" serial="${serial}"`;
  return info;
}

async function fixInterfaceNames(device_, interfaces) {
  // Check if any interface names were not read correctly
  if (interfaces.some((intf) => intf.name == null)) {
    // Manually retrieve the interface name string descriptors
    let tempDevice = new dfu.Device(device_, interfaces[0]);
    await tempDevice.device_.open();
    await tempDevice.device_.selectConfiguration(1);
    let mapping = await tempDevice.readInterfaceNames();
    await tempDevice.close();

    for (let intf of interfaces) {
      if (intf.name === null) {
        let configIndex = intf.configuration.configurationValue;
        let intfNumber = intf["interface"].interfaceNumber;
        let alt = intf.alternate.alternateSetting;
        intf.name = mapping[configIndex][intfNumber][alt];
      }
    }
  }
}

function getDFUDescriptorProperties(device) {
  // Attempt to read the DFU functional descriptor
  // TODO: read the selected configuration's descriptor
  return device.readConfigurationDescriptor(0).then(
    (data) => {
      let configDesc = dfu.parseConfigurationDescriptor(data);
      let funcDesc = null;
      let configValue = device.settings.configuration.configurationValue;
      if (configDesc.bConfigurationValue == configValue) {
        for (let desc of configDesc.descriptors) {
          if (
            desc.bDescriptorType == 0x21 &&
            desc.hasOwnProperty("bcdDFUVersion")
          ) {
            funcDesc = desc;
            break;
          }
        }
      }

      if (funcDesc) {
        return {
          WillDetach: (funcDesc.bmAttributes & 0x08) != 0,
          ManifestationTolerant: (funcDesc.bmAttributes & 0x04) != 0,
          CanUpload: (funcDesc.bmAttributes & 0x02) != 0,
          CanDnload: (funcDesc.bmAttributes & 0x01) != 0,
          TransferSize: funcDesc.wTransferSize,
          DetachTimeOut: funcDesc.wDetachTimeOut,
          DFUVersion: funcDesc.bcdDFUVersion,
        };
      } else {
        return {};
      }
    },
    (error) => {}
  );
}

function logProgress(done, total) {
  console.log({ done, total });
}

let connectButton = document.querySelector("#doit");
let vid = parseInt("0x0483", 16);
let serial = "";

function onDisconnect(reason) {
  console.log(reason);
}

function onUnexpectedDisconnect(event) {
  if (device !== null && device.device_ !== null) {
    if (device.device_ === event.device) {
      device.disconnected = true;
      onDisconnect("Device disconnected");
      device = null;
    }
  }
}

async function connect(firmwareFile, device) {
  try {
    await device.open();
  } catch (error) {
    onDisconnect(error);
    throw error;
  }

  // Attempt to parse the DFU functional descriptor
  let desc = {};
  try {
    desc = await getDFUDescriptorProperties(device);
  } catch (error) {
    onDisconnect(error);
    throw error;
  }

  let memorySummary = "";
  if (desc && Object.keys(desc).length > 0) {
    device.properties = desc;
    let info = `WillDetach=${desc.WillDetach}, ManifestationTolerant=${
      desc.ManifestationTolerant
    }, CanUpload=${desc.CanUpload}, CanDnload=${desc.CanDnload}, TransferSize=${
      desc.TransferSize
    }, DetachTimeOut=${desc.DetachTimeOut}, Version=${hex4(desc.DFUVersion)}`;
    console.log(info);
    // transferSizeField.value = desc.TransferSize;
    // transferSize = desc.TransferSize;
    if (desc.CanDnload) {
      manifestationTolerant = desc.ManifestationTolerant;
    }

    if (device.settings.alternate.interfaceProtocol == 0x02) {
      console.log("canupload", desc.CanUpload, "candownload", desc.CanDnload);
    }

    if (
      desc.DFUVersion == 0x011a &&
      device.settings.alternate.interfaceProtocol == 0x02
    ) {
      device = new dfuse.Device(device.device_, device.settings);
      if (device.memoryInfo) {
        let totalSize = 0;
        for (let segment of device.memoryInfo.segments) {
          totalSize += segment.end - segment.start;
        }
        memorySummary = `Selected memory region: ${
          device.memoryInfo.name
        } (${niceSize(totalSize)})`;
        for (let segment of device.memoryInfo.segments) {
          let properties = [];
          if (segment.readable) {
            properties.push("readable");
          }
          if (segment.erasable) {
            properties.push("erasable");
          }
          if (segment.writable) {
            properties.push("writable");
          }
          let propertySummary = properties.join(", ");
          if (!propertySummary) {
            propertySummary = "inaccessible";
          }

          memorySummary += `\n${hexAddr8(segment.start)}-${hexAddr8(
            segment.end - 1
          )} (${propertySummary})`;
        }
      }
    }
  }

  // Bind logging methods
  device.logProgress = logProgress;

  // Display basic USB information
  console.log(
    "Name: " +
      device.device_.productName +
      "\n" +
      "MFG: " +
      device.device_.manufacturerName +
      "\n" +
      "Serial: " +
      device.device_.serialNumber +
      "\n"
  );

  // Display basic dfu-util style info
  console.log(formatDFUSummary(device) + "\n" + memorySummary);

  if (device.memoryInfo) {
    let segment = device.getFirstWritableSegment();
    if (segment) {
      device.startAddress = segment.start;
      //   dfuseStartAddressField.value = "0x" + segment.start.toString(16);
      maxReadSize = device.getMaxReadSize(segment.start);
      console.log(maxReadSize, firmwareFile);
      // const [handle] = await window.showOpenFilePicker();
      // const firmwareFile = window.doTheStuffFile;
      //await (await handle.getFile()).arrayBuffer();

      if (device && firmwareFile != null) {
        try {
          let status = await device.getStatus();
          if (status.state == dfu.dfuERROR) {
            await device.clearStatus();
          }
        } catch (error) {
          device.logWarning("Failed to clear status");
        }
        await device.do_download(2048, firmwareFile, true).then(
          () => {
            console.log("Done!");
          },
          (error) => {
            console.log(error);
          }
        );
      }
    }
  }

  return device;
}

function autoConnect(vid, serial) {
  dfu.findAllDfuInterfaces().then(async (dfu_devices) => {
    let matching_devices = [];
    for (let dfu_device of dfu_devices) {
      if (serial) {
        if (dfu_device.device_.serialNumber == serial) {
          matching_devices.push(dfu_device);
        }
      } else if (dfu_device.device_.vendorId == vid) {
        matching_devices.push(dfu_device);
      }
    }

    if (matching_devices.length == 0) {
      console.log("No device found.");
    } else {
      if (matching_devices.length == 1) {
        console.log("Connecting...");
        device = matching_devices[0];
        console.log(device);
        device = await connect(device);
      } else {
        console.log("Multiple DFU interfaces found.");
      }
      vid = matching_devices[0].device_.vendorId;
    }
  });
}

window.doTheStuff = function (data) {
  console.log(data);
  // Check if WebUSB is available
  if (typeof navigator.usb !== "undefined") {
    navigator.usb.addEventListener("disconnect", onUnexpectedDisconnect);
    autoConnect(vid, serial);
  } else {
    console.log("WebUSB not available.");
  }

  if (device) {
    device.close().then(onDisconnect);
    device = null;
  } else {
    let filters = [];
    if (serial) {
      filters.push({ serialNumber: serial });
    } else if (vid) {
      filters.push({ vendorId: vid });
    }
    navigator.usb
      .requestDevice({ filters: filters })
      .then(async (selectedDevice) => {
        let interfaces = dfu.findDeviceDfuInterfaces(selectedDevice);
        if (interfaces.length == 0) {
          console.log(
            selectedDevice,
            "The selected device does not have any USB DFU interfaces."
          );
        } else if (interfaces.length == 1) {
          await fixInterfaceNames(selectedDevice, interfaces);
          device = await connect(
            data,
            new dfu.Device(selectedDevice, interfaces[0])
          );
        } else {
          await fixInterfaceNames(selectedDevice, interfaces);
          device = await connect(
            data,
            new dfu.Device(selectedDevice, interfaces[0])
          );
        }
      })
      .catch((error) => {
        console.error(error);
      });
  }
};
