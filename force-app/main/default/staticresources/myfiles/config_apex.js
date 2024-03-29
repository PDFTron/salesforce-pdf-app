var resourceURL = "/resource/";
window.Core.forceBackendType("ems");

var urlSearch = new URLSearchParams(location.hash);
var custom = JSON.parse(urlSearch.get("custom"));
resourceURL = resourceURL + custom.namespacePrefix;

/**
 * The following `window.CoreControls.set*` functions point WebViewer to the
 * optimized source code specific for the Salesforce platform, to ensure the
 * uploaded files stay under the 5mb limit
 */
// office workers
window.Core.setOfficeWorkerPath(resourceURL + "office");
window.Core.setOfficeAsmPath(resourceURL + "office_asm");
window.Core.setOfficeResourcePath(resourceURL + "office_resource");

// legacy office workers
window.Core.setLegacyOfficeWorkerPath(resourceURL + "legacyOffice");
window.Core.setLegacyOfficeAsmPath(resourceURL + "legacyOffice_asm");
window.Core.setLegacyOfficeResourcePath(resourceURL + "legacyOffice_resource");
// pdf workers
window.Core.setPDFResourcePath(resourceURL + "resource");
if (custom.fullAPI) {
  window.Core.setPDFWorkerPath(resourceURL + "pdf_full");
} else {
  window.Core.setPDFWorkerPath(resourceURL + "pdf_lean");
}

// external 3rd party libraries
window.Core.setExternalPath(resourceURL + "external");
window.Core.setCustomFontURL(
  "https://pdftron.s3.amazonaws.com/custom/ID-zJWLuhTffd3c/vlocity/webfontsv20/"
);

const { documentViewer, annotationManager, Annotations } = instance.Core;

const redactionSearchSamples = [
  {
    key: "phone",
    value: `\\d?(\\s?|-?|\\+?|\\.?)((\\(\\d{1,4}\\))|(\\d{1,3})|\\s?)(\\s?|-?|\\.?)((\\(\\d{1,3}\\))|(\\d{1,3})|\\s?)(\\s?|-?|\\.?)((\\(\\d{1,3}\\))|(\\d{1,3})|\\s?)(\\s?|-?|\\.?)\\d{3}(-|\\.|\\s)\\d{4,5}`,
  },
  {
    key: "email",
    value: `\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,6}\\b`,
  },
  {
    key: "date",
    value: "(\\b(0?[1-9]|[12]\\d|30|31)[^\\w\\d\\r\\n:](0?[1-9]|1[0-2])[^\\w\\d\\r\\n:](\\d{4}|\\d{2})\\b)|(\\b(0?[1-9]|1[0-2])[^\\w\\d\\r\\n:](0?[1-9]|[12]\\d|30|31)[^\\w\\d\\r\\n:](\\d{4}|\\d{2})\\b)",
  },
];


async function saveDocument() {
  // SF document file size limit
  const docLimit = 5 * Math.pow(1024, 2);
  const doc = instance.Core.documentViewer.getDocument();
  if (!doc) {
    return;
  }
  instance.UI.openElement('loadingModal');
  const fileSize = await doc.getFileSize();
  const fileType = doc.getType();
  let filename = doc.getFilename();

  if (fileType == 'image'){
    filename = filename.replace(/\.[^/.]+$/, ".pdf")
  }
  const xfdfString = await instance.Core.documentViewer.getAnnotationManager().exportAnnotations();
  const data = await doc.getFileData({
    // Saves the document with annotations in it
    xfdfString
  });

  let binary = '';
  const bytes = new Uint8Array(data);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  const base64Data = window.btoa(binary);

  const payload = {
    title: filename.replace(/\.[^/.]+$/, ""),
    filename,
    base64Data,
    contentDocumentId: currentDocId
  }
  // Post message to LWC
  fileSize < docLimit ? parent.postMessage({ type: 'SAVE_DOCUMENT', payload }, '*') : downloadWebViewerFile();
}

function createSavedModal(instance) {
  const divInput = document.createElement('div');
  divInput.innerText = 'File saved successfully.';
  const modal = {
    dataElement: 'savedModal',
    body: {
      className: 'myCustomModal-body',
      style: {
        'text-align': 'center'
      },
      children: [divInput]
    }
  }
  instance.UI.addCustomModal(modal);
}

async function getBase64FromUrl(url, token){
  const data = await fetch(url, {"headers": {
      "Authorization" : "Bearer " + token
  }});
  const blob = await data.blob();
  return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob); 
      reader.onloadend = function() {
          const base64data = reader.result;   
          resolve(base64data.split(",")[1]);
      }
  });
}

async function replaceContent(searchString, replacementString) {
  const documentViewer = instance.Core.documentViewer;
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
    for (var i = 1; i <= documentViewer.getPageCount(); ++i) {
      const page = await PDFdoc.getPage(i);
      await replacer.process(page);
    }
  });

  documentViewer.refreshAll();
  documentViewer.updateView();
  documentViewer.getDocument().refreshTextData();
}

window.addEventListener("viewerLoaded", async function () {
  if(custom.hasPermission) {
   //setup for users with permission 
  } else {
   //setup for user without permission 
  }
  //set current user, set up mentions for sample users
  instance.Core.documentViewer
    .getAnnotationManager()
    .setCurrentUser(custom.username);
  instance.UI.mentions.setUserData(JSON.parse(custom.userlist));

  instance.UI.enableFeatures([instance.UI.Feature.Redaction]);
  instance.UI.setToolbarGroup("toolbarGroup-View");

  instance.UI.disableElements(["header"]);
  instance.UI.hotkeys.on("ctrl+s, command+s", (e) => {
    e.preventDefault();
    saveDocument();
  });

  // Create a button, with a disk icon, to invoke the saveDocument function
  instance.UI.setHeaderItems(function (header) {
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
    header.push(myCustomButton);
  });
  createSavedModal(instance);
});

documentViewer.addEventListener('documentLoaded', async () => {
  const { documentViewer } = instance.Core;
  console.log('document loaded!');

  instance.UI.setLayoutMode(instance.UI.LayoutMode.FacingContinuous)
  
  documentViewer.updateView();
  let filetype = documentViewer.getDocument().getFilename().split('.').pop();

  const doc = documentViewer.getDocument();
  const keys = await doc.getTemplateKeys();

  console.log("keys", keys);



  (filetype == 'docx') ? parent.postMessage({ type: 'DOC_KEYS', keys }, '*') : '';
});

window.addEventListener("message", receiveMessage, false);

async function loadTIFF(payload){
  var blob = payload.blob;
  
  await PDFNet.runWithoutCleanup(async () => {
    var newDoc = await PDFNet.PDFDoc.create();
    newDoc.initSecurityHandler();
    newDoc.lock();

    let bufferTiff = await blob.arrayBuffer();
    const tiffFile = await PDFNet.Filter.createFromMemory(bufferTiff);
    await PDFNet.Convert.fromTiff(newDoc, tiffFile);
    const buffer = await newDoc.saveMemoryBuffer(PDFNet.SDFDoc.SaveOptions.e_linearized);
    newDoc.unlock();
    instance.loadDocument(newDoc);
  });
}

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


    annotManager.addAnnotations(newAnnotations);
    annotManager.drawAnnotationsFromList(newAnnotations);
  };

  if (event.isTrusted && typeof event.data === "object") {
    switch (event.data.type) {
      case "RIBBON_CHANGE":
        //UI customization based on use case
        switch (event.data.ribbon) {
          case "Search Text":
            instance.UI.disableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-View");
            instance.UI.openElements(["searchPanel"]);
            instance.UI.closeElements(["redactionPanel"]);
            break;
          case "Measure Distances":
            instance.UI.enableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Measure");
            instance.UI.closeElements(["redactionPanel"]);
            break;
          case "Annotate Documents":
            instance.UI.disableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Annotate");
            instance.UI.closeElements(["redactionPanel"]);
            break;
          case "Save Documents":
            instance.UI.disableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Annotate");
            instance.UI.closeElements(["redactionPanel"]);
            break;
          case "Replace Content":
            instance.UI.disableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-View");
            instance.UI.closeElements(["redactionPanel"]);
            break;
          case "Redact Content":
            instance.UI.disableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup('toolbarGroup-Redact');
            instance.UI.openElements(["redactionPanel"]);
            break;
          case "Edit Page(s)":
            instance.UI.disableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.openElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-View");
            instance.UI.closeElements(["redactionPanel"]);
            break;
          case "Sign Documents":
            instance.UI.disableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-FillAndSign");
            instance.UI.closeElements(["redactionPanel"]);
            break;
          case "Form Fields":
            instance.UI.disableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Forms");
            instance.UI.closeElements(["redactionPanel"]);
            break;
          case "Crop Documents":
            instance.UI.disableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Edit");
            instance.UI.setToolMode(Tools.ToolNames.CROP);
            instance.UI.closeElements(["redactionPanel"]);
            break;
          case "Collaborate - Comments, Mentions, Approvals":
            instance.UI.disableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.enableElements(["header"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.openElements(["notesPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-Annotate");
            instance.UI.closeElements(["redactionPanel"]);
            break;
          default:
            instance.UI.disableFeatures([instance.UI.Feature.Measurement]);
            instance.UI.closeElements(["notesPanel"]);
            instance.UI.closeElements(["leftPanel"]);
            instance.UI.closeElements(["searchPanel"]);
            instance.UI.setToolbarGroup("toolbarGroup-View");
            instance.UI.disableElements(["header"]);
            instance.UI.closeElements(["redactionPanel"]);
            break;
        }
        break;
      case "OPEN_DOCUMENT":
        instance.loadDocument(event.data.file);
        break;
      case "OPEN_DOCUMENT_BLOB":
        const { blob, extension, filename, documentId } = event.data.payload;
        currentDocId = documentId;
        instance.UI.loadDocument(blob, { extension, filename, documentId });
        break;
      case "DOCUMENT_SAVED":
        console.log(`${JSON.stringify(event.data)}`);
        instance.UI.openElements(['savedModal']);
        setTimeout(() => {
          instance.UI.closeElements(['savedModal', 'loadingModal'])
        }, 2000);
        break;
      case "DOCUMENT_DOWNLOADED":
        instance.showErrorMessage("Document downloaded!");
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
      case 'REDACT_CONTENT_PHONE':
        instance.showErrorMessage('Searching for phone numbers');
        documentViewer.clearSearchResults();
        instance.addSearchListener(searchListener);
        instance.searchTextFull(redactionSearchSamples[0].value, { regex: true });
        setTimeout(() => {
          instance.closeElements(['errorModal', 'loadingModal'])
        }, 2000)
        break;
      case 'REDACT_CONTENT_EMAIL':
        instance.showErrorMessage('Searching for emails');
        documentViewer.clearSearchResults();
        instance.addSearchListener(searchListener);
        instance.searchTextFull(redactionSearchSamples[1].value, { regex: true });
        setTimeout(() => {
          instance.closeElements(['errorModal', 'loadingModal'])
        }, 2000)
        break;
      case 'REDACT_CONTENT_DTM':
        instance.showErrorMessage('Searching for dates');
        documentViewer.clearSearchResults();
        instance.addSearchListener(searchListener);
        instance.searchTextFull(redactionSearchSamples[2].value, { regex: true });
        setTimeout(() => {
          instance.closeElements(['errorModal', 'loadingModal'])
        }, 2000)
        break;
      case "LMS_RECEIVED":
        instance.showErrorMessage("Link received: " + event.data.message);
        setTimeout(() => {
          instance.closeElements(["errorModal", "loadingModal"]);
        }, 2000);
        break;
      case "CLOSE_DOCUMENT":
        instance.UI.closeDocument();
        break;
      case 'EXPORT_DOCUMENT':
        transportDocument(event.data.payload, true)
        break;
      case 'DOWNLOAD_DOCUMENT':
        transportDocument(event.data.payload, false)
        break;
      case 'FILL_TEMPLATE':
        fillDocument(event);
        break;
      case 'OPEN_TIFF_BLOB':
        loadTIFF(event.data.payload);
        break;
      default:
        break;
    }
  }
}

async function fillDocument(event) {
  const autofillMap = event.data.mapping;

  console.log('autofillMap', autofillMap);

  await documentViewer.getDocument().applyTemplateValues(autofillMap);

}
let currentDocId;

function transportDocument(payload, transport){
  switch (payload.exportType) {
    case 'jpg':
    case 'png':
      // PDF to Image (png, jpg)
      pdfToImage(payload, transport);
      break;
    case 'pdf':
      // DOC, Images to PDF
      toPdf(payload, transport);
      break;
  }
}

// Basic function that retrieves any viewable file from the viewer and downloads it as a pdf
async function toPdf (payload, transport) {
  if (transport){

      await PDFNet.initialize();
      const doc = instance.Core.documentViewer.getDocument();
      const buffer = await doc.getFileData({ downloadType: payload.exportType });
      const bufferFile = new Uint8Array(buffer);


      exportFile(bufferFile, payload.file, "." + payload.exportType);

  } else {

    let file = payload.file;

    parent.postMessage({ type: 'DOWNLOAD_CONVERT_DOCUMENT', file }, '*');

    instance.downloadPdf({filename: payload.file});

  }
}


const pdfToImage = async (payload, transport) => {

  await PDFNet.initialize();

  let doc = null;

  await PDFNet.runWithCleanup(async () => {

    const buffer = await payload.blob.arrayBuffer();
    doc = await PDFNet.PDFDoc.createFromBuffer(buffer);
    doc.initSecurityHandler();
    doc.lock();

    const count = await doc.getPageCount();
    const pdfdraw = await PDFNet.PDFDraw.create(92);
    
    let itr;
    let currPage;
    let bufferFile;
    let page = (count > 1) ? '(pg_' : ''
    // Handle multiple pages
    for (let i = 1; i <= count; i++){
      let pageNum = page ? (page + i + ')') : ''
      itr = await doc.getPageIterator(i);
      currPage = await itr.current();
      bufferFile = await pdfdraw.exportStream(currPage, payload.exportType.toUpperCase());
      transport ? exportFile(bufferFile, payload.file + pageNum, "." + payload.exportType) : downloadFile(bufferFile, payload.file + pageNum, "." + payload.exportType);

    }

  }); 

}

// Master download method
const downloadFile = (buffer, fileName, fileExtension) => {
  const blob = new Blob([buffer]);
  const link = document.createElement('a');

  const file = fileName + fileExtension;
  // create a blobURI pointing to our Blob
  link.href = URL.createObjectURL(blob);
  link.download = fileName + fileExtension;
  // some browser needs the anchor to be in the doc
  document.body.append(link);
  link.click();
  link.remove();

  parent.postMessage({ type: 'DOWNLOAD_CONVERT_DOCUMENT', file }, '*') 
  // in case the Blob uses a lot of memory
  setTimeout(() => URL.revokeObjectURL(link.href), 7000);
};


function exportFile (buffer, fileName, fileExtension) {
  const docLimit = 5 * Math.pow(1024, 2);
  const fileSize = buffer.byteLength;

  let binary = '';
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }

  const base64Data = window.btoa(binary);

  const payload = {
    title: fileName.replace(/\.[^/.]+$/, ""),
    filename: fileName + fileExtension,
    base64Data,
    contentDocumentId: currentDocId
  }
  // Post message to LWC
  fileSize < docLimit ? parent.postMessage({ type: 'SAVE_CONVERT_DOCUMENT', payload }, '*') : downloadFile(buffer, fileName, "." + fileExtension);
}
