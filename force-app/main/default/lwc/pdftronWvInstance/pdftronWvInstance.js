import { LightningElement, wire, track, api } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
import { loadScript } from 'lightning/platformResourceLoader';
import libUrl from '@salesforce/resourceUrl/lib';
import myfilesUrl from '@salesforce/resourceUrl/myfiles';
import { publish, createMessageContext, releaseMessageContext, subscribe, unsubscribe } from 'lightning/messageService';
import WebViewerMC from "@salesforce/messageChannel/WebViewerMessageChannel__c";
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import mimeTypes from './mimeTypes'
import { registerListener, unregisterAllListeners } from 'c/pubsub';
import saveDocument from '@salesforce/apex/PDFTron_ContentVersionController.saveDocument';

function _base64ToArrayBuffer(base64) {
  var binary_string = window.atob(base64);
  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

export default class PdftronWvInstance extends LightningElement {
  config = '/config_apex.js';

  @track receivedMessage = '';
  channel;
  context = createMessageContext();

  source = 'My file';
  fullAPI = true;
  enableRedaction = true;
  @api recordId;

  @wire(CurrentPageReference)
  pageRef;

  constructor() {
    super();
  }

  connectedCallback() {
    //'/sfc/servlet.shepherd/version/download/0694x000000pEGyAAM'
    ///servlet/servlet.FileDownload?file=documentId0694x000000pEGyAAM
    this.handleSubscribe();
    registerListener('blobSelected', this.handleBlobSelected, this);
    registerListener('search', this.search, this);
    registerListener('video', this.loadVideo, this);
    registerListener('replace', this.contentReplace, this);
    registerListener('redact', this.contentRedact, this);
    registerListener('redactPhone', this.contentRedactPhone, this);
    registerListener('redactDTM', this.contentRedactDTM, this);
    registerListener('redactEmail', this.contentRedactEmail, this);
    window.addEventListener('message', this.handleReceiveMessage.bind(this), false);
  }

  disconnectedCallback() {
    unregisterAllListeners(this);
    window.removeEventListener('message', this.handleReceiveMessage, true);
    this.handleUnsubscribe();
  }

  handleSubscribe() {
    if (this.channel) {
      return;
    }
    this.channel = subscribe(this.context, WebViewerMC, (message) => {
      if (message) {
        console.log(message);
      }
    });
  }

  handleUnsubscribe() {
    releaseMessageContext(this.context);
    unsubscribe(this.channel);
  }

  contentReplace(payload) {
    this.iframeWindow.postMessage({ type: 'REPLACE_CONTENT', payload }, '*');
  }

  contentRedact() {
    this.iframeWindow.postMessage({ type: 'REDACT_CONTENT' }, '*');
  }

  contentRedactPhone() {
    this.iframeWindow.postMessage({ type: 'REDACT_CONTENT_PHONE' }, '*');
  }

  contentRedactDTM() {
    this.iframeWindow.postMessage({ type: 'REDACT_CONTENT_DTM' }, '*');
  }

  contentRedactEmail() {
    this.iframeWindow.postMessage({ type: 'REDACT_CONTENT_EMAIL' }, '*');
  }

  loadVideo(url) {
    this.iframeWindow.postMessage({ type: 'LOAD_VIDEO', url }, '*');
  }

  search(term) {
    this.iframeWindow.postMessage({ type: 'SEARCH_DOCUMENT', term }, '*');
  }

  handleBlobSelected(record) {
    record = JSON.parse(record);

    var blobby = new Blob([_base64ToArrayBuffer(record.body)], {
      type: mimeTypes[record.FileExtension]
    });

    const payload = {
      blob: blobby,
      extension: record.cv.FileExtension,
      filename: record.cv.Title + "." + record.cv.FileExtension,
      documentId: record.cv.Id
    };
    this.iframeWindow.postMessage({ type: 'OPEN_DOCUMENT_BLOB', payload }, '*');
  }

  renderedCallback() {
    var self = this;
    if (this.uiInitialized) {
      return;
    }
    this.uiInitialized = true;

    Promise.all([
      loadScript(self, libUrl + '/webviewer.min.js')
    ])
      .then(() => this.initUI())
      .catch(console.error);
  }

  initUI() {
    var myObj = {
      libUrl: libUrl,
      fullAPI: this.fullAPI || false,
      namespacePrefix: '',
    };
    var url = myfilesUrl + '/webviewer-demo-annotated.pdf';

    const viewerElement = this.template.querySelector('div')
    // eslint-disable-next-line no-unused-vars
    const viewer = new PDFTron.WebViewer({
      path: libUrl, // path to the PDFTron 'lib' folder on your server
      custom: JSON.stringify(myObj),
      backendType: 'ems',
      initialDoc: url,
      config: myfilesUrl + this.config,
      fullAPI: this.fullAPI,
      enableFilePicker: this.enableFilePicker,
      enableRedaction: this.enableRedaction,
      enableMeasurement: this.enableMeasurement,
      // l: 'YOUR_LICENSE_KEY_HERE',
    }, viewerElement);

    viewerElement.addEventListener('ready', () => {
      this.iframeWindow = viewerElement.querySelector('iframe').contentWindow;
    })

  }

  handleReceiveMessage(event) {
    const me = this;
    if (event.isTrusted && typeof event.data === 'object') {
      switch (event.data.type) {
        case 'SAVE_DOCUMENT':
          saveDocument({ json: JSON.stringify(event.data.payload), recordId: this.recordId }).then((response) => {
            me.iframeWindow.postMessage({ type: 'DOCUMENT_SAVED', response }, '*')
          }).catch(error => {
            console.error(JSON.stringify(error));
          });
          break;
        default:
          break;
      }
    }
  }
}