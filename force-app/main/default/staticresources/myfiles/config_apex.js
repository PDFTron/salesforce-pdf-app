var resourceURL = "/resource/";
Core.forceBackendType("ems");

var urlSearch = new URLSearchParams(location.hash);
var custom = JSON.parse(urlSearch.get("custom"));
resourceURL = resourceURL + custom.namespacePrefix;

/**
 * The following `window.CoreControls.set*` functions point WebViewer to the
 * optimized source code specific for the Salesforce platform, to ensure the
 * uploaded files stay under the 5mb limit
 */
// office workers
Core.setOfficeWorkerPath(resourceURL + "office");
Core.setOfficeAsmPath(resourceURL + "office_asm");
Core.setOfficeResourcePath(resourceURL + "office_resource");

// legacy office workers
Core.setLegacyOfficeWorkerPath(resourceURL + "legacyOffice");
Core.setLegacyOfficeAsmPath(resourceURL + "legacyOffice_asm");
Core.setLegacyOfficeResourcePath(resourceURL + "legacyOffice_resource");
// pdf workers
Core.setPDFResourcePath(resourceURL + "resource");
if (custom.fullAPI) {
  Core.setPDFWorkerPath(resourceURL + "pdf_full");
  Core.setPDFAsmPath(resourceURL + "asm_full");
} else {
  Core.setPDFWorkerPath(resourceURL + "pdf_lean");
  Core.setPDFAsmPath(resourceURL + "asm_lean");
}

// external 3rd party libraries
Core.setExternalPath(resourceURL + "external");
Core.setCustomFontURL(
  "https://pdftron.s3.amazonaws.com/custom/ID-zJWLuhTffd3c/vlocity/webfontsv20/"
);

async function saveDocument() {
  const docViewer = instance.Core.documentViewer;
  const doc = docViewer.getDocument();
  if (!doc) {
    return;
  }

  instance.openElement("loadingModal");

  const fileType = doc.getType();
  const filename = doc.getFilename();

  // xfdf string can be saved to a custom object
  // to achieve this fire event to LWC here, and pass data to apex
  const xfdfString = await docViewer.getAnnotationManager().exportAnnotations();

  //flatten document to include annotations
  const data = await doc.getFileData({
    // Saves the document with annotations in it
    xfdfString,
  });

  //build a blob
  let binary = "";
  const bytes = new Uint8Array(data);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  const base64Data = window.btoa(binary);

  const payload = {
    title: filename.replace(/\.[^/.]+$/, ""),
    filename,
    base64Data,
    contentDocumentId: doc.__contentDocumentId,
  };
  // Post message to LWC, which in turn calls PDFTron_ContentVersionController.saveDocument() in the Apex controller
  parent.postMessage({ type: "SAVE_DOCUMENT", payload }, "*");
}

async function addSaveButton() {
  /**
   * On keydown of either the button combination Ctrl+S or Cmd+S, invoke the
   * saveDocument function
   */
  instance.hotkeys.on("ctrl+s, command+s", (e) => {
    e.preventDefault();
    saveDocument();
  });

  // Create a button, with a disk icon, to invoke the saveDocument function
  instance.setHeaderItems(function (header) {
    var myCustomButton = {
      type: "actionButton",
      dataElement: "saveDocumentButton",
      title: "tool.SaveDocument",
      img:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>',
      onClick: function () {
        saveDocument();
      },
    };
    header.get("viewControlsButton").insertBefore(myCustomButton);
  });
}

async function replaceContent(searchString, replacementString) {
  const docViewer = instance.Core.documentViewer;
  const doc = instance.Core.documentViewer.getDocument(); //get current document from WV
  if (!doc) {
    return;
  }
  const PDFdoc = await doc.getPDFDoc(); //pass WV Doc to PDFNet
  await PDFNet.initialize();

  PDFdoc.initSecurityHandler();
  PDFdoc.lock();

  // Run PDFNet methods with memory management
  await PDFNet.runWithCleanup(async () => {
    // lock the document before a write operation
    // runWithCleanup will auto unlock when complete
    const replacer = await PDFNet.ContentReplacer.create();
    await replacer.setMatchStrings(
      searchString.charAt(0),
      searchString.slice(-1)
    );
    await replacer.addString(searchString.slice(1, -1), replacementString);
    for (var i = 1; i <= docViewer.getPageCount(); ++i) {
      const page = await PDFdoc.getPage(i);
      await replacer.process(page);
    }
  });

  docViewer.refreshAll();
  docViewer.updateView();
  docViewer.getDocument().refreshTextData();
}

window.addEventListener("viewerLoaded", async function () {
  //set current user, set up mentions for sample users
  instance.Core.documentViewer
    .getAnnotationManager()
    .setCurrentUser(custom.username);
  instance.UI.mentions.setUserData(JSON.parse(custom.userlist));

  instance.enableFeatures([instance.Feature.Redaction]);
  instance.UI.setToolbarGroup("toolbarGroup-View");

  instance.UI.disableElements(["header"]);
  addSaveButton();
});

window.addEventListener("message", receiveMessage, false);

function receiveMessage(event) {
  //search callback
  const annotManager = instance.Core.documentViewer.getAnnotationManager();

  const searchListener = (searchTerm, options, results) => {
    // add redaction annotation for each search result
    const newAnnotations = results.map((result) => {
      const annotation = new Annotations.RedactionAnnotation();
      annotation.PageNumber = result.pageNum;
      annotation.Quads = result.quads.map((quad) => quad.getPoints());
      annotation.StrokeColor = new Annotations.Color(136, 39, 31);
      return annotation;
    });

    console.log(newAnnotations);

    annotManager.addAnnotations(newAnnotations);
    annotManager.drawAnnotationsFromList(newAnnotations);
  };

  if (event.isTrusted && typeof event.data === "object") {
    switch (event.data.type) {
      case "RIBBON_CHANGE":
        //UI customization based on use case
        switch (event.data.ribbon) {
          case "Search Text":
            instance.UI.disableFeatures([instance.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-View");
            instance.UI.openElements(["searchPanel"]);
            break;
          case "Measure Distances":
            instance.UI.enableFeatures([instance.Feature.Measurement]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Measure");
            break;
          case "Annotate Documents":
            instance.UI.disableFeatures([instance.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Annotate");
            break;
          case "Save Documents":
            instance.UI.disableFeatures([instance.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Annotate");
            break;
          case "Replace Content":
            instance.UI.disableFeatures([instance.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-View");
            break;
          case "Redact Content":
            instance.UI.disableFeatures([instance.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Edit");
            instance.UI.setToolMode(Tools.ToolNames.REDACTION);
            break;
          case "Edit Page(s)":
            instance.UI.disableFeatures([instance.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.openElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-View");
            break;
          case "Sign Documents":
            instance.UI.disableFeatures([instance.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-FillAndSign");
            break;
          case "Form Fields":
            instance.UI.disableFeatures([instance.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Forms");
            break;
          case "Crop Documents":
            instance.UI.disableFeatures([instance.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Edit");
            instance.UI.setToolMode(Tools.ToolNames.CROP);
            break;
          case "Collaborate - Comments, Mentions, Approvals":
            instance.UI.disableFeatures([instance.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.openElements(["notesPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Annotate");
            break;
          default:
            instance.UI.disableFeatures([instance.Feature.Measurement]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-View");
            instance.UI.disableElements(["header"]);
            break;
        }
        break;
      case "OPEN_DOCUMENT":
        instance.loadDocument(event.data.file);
        break;
      case "OPEN_DOCUMENT_BLOB":
        const { blob, extension, filename, documentId } = event.data.payload;
        instance.loadDocument(blob, { extension, filename, documentId });
        break;
      case "DOCUMENT_SAVED":
        instance.showErrorMessage("Document saved!");
        setTimeout(() => {
          instance.closeElements(["errorModal", "loadingModal"]);
        }, 2500);
        break;
      case "SEARCH_DOCUMENT":
        if (event.data.term) {
          instance.showErrorMessage(`Searching for ${event.data.term}`);

          const searchOptions = {
            caseSensitive: true, // match case
            wholeWord: true, // match whole words only
            wildcard: false, // allow using '*' as a wildcard value
            regex: false, // string is treated as a regular expression
            searchUp: false, // search from the end of the document upwards
            ambientString: true, // return ambient string as part of the result
          };
          instance.addSearchListener(searchListener);
          instance.searchTextFull(event.data.term, searchOptions);
          instance.closeElements(["errorModal", "loadingModal"]);
        }
        break;
      case "REPLACE_CONTENT":
        instance.showErrorMessage("Replacing content");
        const { searchString, replacementString } = event.data.payload;
        replaceContent(searchString, replacementString);
        setTimeout(() => {
          instance.closeElements(["errorModal", "loadingModal"]);
        }, 3000);
        break;
      case "REDACT_CONTENT":
        instance.showErrorMessage("Applying redactions");
        instance.Core.documentViewer.getAnnotationManager().applyRedactions();
        setTimeout(() => {
          instance.closeElements(["errorModal", "loadingModal"]);
        }, 2000);
        break;
      case "LMS_RECEIVED":
        instance.showErrorMessage("Link received: " + event.data.message);
        setTimeout(() => {
          instance.closeElements(["errorModal", "loadingModal"]);
        }, 2000);
        break;
      case "CLOSE_DOCUMENT":
        instance.closeDocument();
        break;
      default:
        break;
    }
  }
}
