public with sharing class PDFTron_ContentVersionController {
  private final static Integer MAX_RESULTS = 7;
  
  static Set<String> supportedFileFormats = new Set<String>{
    'pdf', 
    'xfdf',
    'fdf',
    'doc',
    'docx', 
    'xlsx',
    'ppt',
    'pptx',
    'jpg',
    'jpeg',
    'png',
    'mov',
    'tif',
    'tiff',
    'xls',
    'xlsx'
  };
  /*
    @AuraEnabled(Cacheable=true)
    public static PDFTron_Setting__mdt[] getPdftronSettings() {
        PDFTron_Setting__mdt[] mdtMap = [SELECT MasterLabel, DeveloperName, Permission_Level__c, NamespacePrefix, QualifiedAPIName FROM PDFTron_Setting__mdt LIMIT 1];
        return mdtMap;
    }
*/
  @AuraEnabled
  public static string getUser() {
    try {
      User currentUser = [
        SELECT FirstName, LastName
        FROM User
        WHERE username = :UserInfo.getUsername()
      ];

      return currentUser.FirstName + ' ' + currentUser.LastName;
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }

  @AuraEnabled
  public static List<User> getUsers() {
    try {
      return [SELECT FirstName, LastName, Email FROM User];
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }
  
  @AuraEnabled
  public static Boolean getCustomPermission(String permission) {
    return FeatureManagement.checkPermission(permission);
  }

  @AuraEnabled
  public static ContentVersionWrapper getBase64FromCv(String recordId) {
    try {
      ContentVersion cv = [
        SELECT Id, Title, FileExtension, VersionData
        FROM ContentVersion
        WHERE Id = :recordId AND IsLatest = TRUE
        LIMIT 1
      ];
      return new ContentVersionWrapper(cv, true);
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }

  @AuraEnabled
  public static String saveDocument(String json, String recordId, String cvId) {
    try {
      //parse annotated document payload and create new ContentVersion
      PDFTron_ContentVersionPayload pl = new PDFTron_ContentVersionPayload(
        json
      );
      ContentVersion annotatedCv = new ContentVersion();

      //retrieve original document before annotation
      List<ContentVersion> cvList = [
        SELECT ContentDocumentId
        FROM ContentVersion
        WHERE Id = :cvId
      ];

      if (cvList.size() == 1) {
        //retrieve and delete original document
        List<ContentDocument> originalDocument = [
          SELECT Id
          FROM ContentDocument
          WHERE Id = :cvList[0].ContentDocumentId
        ];

        if (originalDocument.size() > 0)
          delete originalDocument;
      } else {
        System.debug('Could not retrieve record for ' + cvId);
      }
      //build document blob
      annotatedCv.VersionData = EncodingUtil.base64Decode(pl.base64Data);
      annotatedCv.Title = pl.title;
      annotatedCv.PathOnClient = pl.filename;

      insert annotatedCv;

      if (
        annotatedCv.ContentDocumentId == null && String.isNotBlank(recordId)
      ) {
        //get the content version since ContentDocumentId is defined after insert
        List<ContentVersion> contentVersions = [
          SELECT Id, ContentDocumentId
          FROM ContentVersion
          WHERE Id = :annotatedCv.Id
          LIMIT 1
        ];

        //link record with document
        ContentDocumentLink contentDocumentLink = new ContentDocumentLink(
          LinkedEntityId = recordId,
          ContentDocumentId = contentVersions[0].ContentDocumentId,
          ShareType = 'V'
        );
        insert contentDocumentLink;
      }

      return annotatedCv.Id;
    } catch (Exception e) {
      system.debug('### ERROR: ' + e.getMessage());
      throw new AuraHandledException(e.getMessage());
    }
  }

  @AuraEnabled 
  public static String convertDocument(String json, String recordId, String cvId) {
    try {
      //parse annotated document payload and create new ContentVersion
      PDFTron_ContentVersionPayload pl = new PDFTron_ContentVersionPayload(
        json
      );
      ContentVersion annotatedCv = new ContentVersion();

      //retrieve original document before annotation
      List<ContentVersion> cvList = [
        SELECT ContentDocumentId
        FROM ContentVersion
        WHERE Id = :cvId
      ];

      //build document blob
      annotatedCv.VersionData = EncodingUtil.base64Decode(pl.base64Data);
      annotatedCv.Title = pl.title;
      annotatedCv.PathOnClient = pl.filename;

      insert annotatedCv;

      if (
        annotatedCv.ContentDocumentId == null && String.isNotBlank(recordId)
      ) {
        //get the content version since ContentDocumentId is defined after insert
        List<ContentVersion> contentVersions = [
          SELECT Id, ContentDocumentId
          FROM ContentVersion
          WHERE Id = :annotatedCv.Id
          LIMIT 1
        ];

        //link record with document
        ContentDocumentLink contentDocumentLink = new ContentDocumentLink(
          LinkedEntityId = recordId,
          ContentDocumentId = contentVersions[0].ContentDocumentId,
          ShareType = 'V'
        );
        insert contentDocumentLink;
      }

      return annotatedCv.Id;
    } catch (Exception e) {
      system.debug('### ERROR: ' + e.getMessage());
      throw new AuraHandledException(e.getMessage());
    }
  }

  @AuraEnabled
  public static List<ContentVersionWrapper> getAttachments(String recordId) {
    try {
      List<String> cdIdList = new List<String>();
      List<ContentVersionWrapper> cvwList = new List<ContentVersionWrapper>();

      // if (String.isBlank(recordId)) {
      //   for (ContentVersion cv : [
      //     SELECT Id, Title, FileExtension, VersionData, ContentDocumentId
      //     FROM ContentVersion
      //     WHERE IsLatest = TRUE
      //   ]) {
      //     if (checkFileExtension(cv.FileExtension)) {
      //       cvwList.add(new ContentVersionWrapper(cv, false));
      //     }
      //   }
      //   return cvwList;
      // }

      //Find links between record & document
      for (ContentDocumentLink cdl : [
        SELECT id, ContentDocumentId, ContentDocument.LatestPublishedVersionId
        FROM ContentDocumentLink
        WHERE LinkedEntityId = :recordId
      ]) {
        cdIdList.add(cdl.ContentDocumentId);
      }
      //Use links to get attachments
      for (ContentVersion cv : [
            SELECT Id, Title, FileExtension, VersionData, ContentDocumentId
            FROM ContentVersion
            WHERE ContentDocumentId IN :cdIdList 
            AND IsLatest = TRUE ]) {
        if (checkFileExtension(cv.FileExtension)) {
          cvwList.add(new ContentVersionWrapper(cv, false));
        }
      }
      return cvwList;
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }

  //get single file from Id
  @AuraEnabled(Cacheable=true)
  public static ContentVersionWrapper getFileDataFromId(String Id) {
    try {
      Long max = 1024 * 1024 * 10; // kb - mb - 6 MB
      ContentVersion cv = [
        SELECT
          Title,
          FileExtension,
          ContentSize,
          VersionData,
          ContentDocumentId,
          LastModifiedDate
        FROM ContentVersion
        WHERE Id = :Id
      ];

      if (cv.ContentSize > max) {
        throw new PDFTronException(
          'Viewer only supports file sizes up to ' +
          convertBytesToFormattedString(max) +
          ' - current file size: ' +
          convertBytesToFormattedString(cv.ContentSize)
        );
      }
      return new ContentVersionWrapper(cv, true);
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }

  @AuraEnabled
  public static List<LookupSearchResult> getExistingAttachments(
    String recordId
  ) {
    try {
      List<String> cdIdList = new List<String>();
      List<LookupSearchResult> results = new List<LookupSearchResult>();

      //Find links between record & document for attachments
      for (ContentDocumentLink cdl : [
        SELECT id, ContentDocumentId, ContentDocument.LatestPublishedVersionId
        FROM ContentDocumentLink
        WHERE LinkedEntityId = :recordId
      ]) {
        cdIdList.add(cdl.ContentDocumentId);
      }
      //Use links to get attachments
      for (ContentVersion cv : [
        SELECT
          Id,
          Title,
          FileExtension,
          VersionData,
          ContentDocumentId,
          LastModifiedDate,
          LastModifiedBy.Name,
          ContentSize
        FROM ContentVersion
        WHERE ContentDocumentId IN :cdIdList AND IsLatest = TRUE
        ORDER BY CreatedDate DESC
        LIMIT 10
      ]) {
        if (checkFileExtension(cv.FileExtension)) {
          String subtitle =
            'Modified ' +
            cv.LastModifiedDate +
            ' by ' +
            cv.LastModifiedBy.Name;
          results.add(
            new LookupSearchResult(
              cv.Id,
              'ContentVersion',
              getFileLogo(cv.FileExtension),
              cv.Title +
              '.' +
              cv.FileExtension +
              ' (' +
              convertBytesToFormattedString(cv.ContentSize) +
              ')',
              subtitle
            )
          );
        }
      }
      return results;
    } catch (Exception e) {
      throw new AuraHandledException(e.getMessage());
    }
  }

  @AuraEnabled(Cacheable=true)
  public static List<LookupSearchResult> search(
    String searchTerm,
    List<String> selectedIds
  ) {
    searchTerm = '%' + searchTerm + '%';

    // Prepare results
    List<LookupSearchResult> results = new List<LookupSearchResult>();

    for (ContentVersion cv : [
      SELECT
        Title,
        FileExtension,
        LastModifiedDate,
        ContentSize,
        LastModifiedBy.Name,
        CreatedBy.Name,
        CreatedDate
      FROM ContentVersion
      WHERE
        Title LIKE :searchTerm
        OR FileExtension LIKE :searchTerm
        OR LastModifiedBy.Name LIKE :searchTerm
        OR CreatedBy.Name LIKE :searchTerm
      ORDER BY LastModifiedDate DESC
    ]) {
      System.debug(cv);
      if (checkFileExtension(cv.FileExtension)) {
        String subtitle =
          'Modified ' +
          cv.LastModifiedDate +
          ' by ' +
          cv.LastModifiedBy.Name +
          ' - created ' +
          cv.CreatedDate +
          ' by ' +
          cv.CreatedBy.Name;
        results.add(
          new LookupSearchResult(
            cv.Id,
            'ContentVersion',
            getFileLogo(cv.FileExtension),
            cv.Title +
            '.' +
            cv.FileExtension +
            ' (' +
            convertBytesToFormattedString(cv.ContentSize) +
            ')',
            subtitle
          )
        );
      }
    }

    //results.sort();
    return results;
  }

  @AuraEnabled
  public static String createCMTRecord(String jsonString){
        try {
            Map<String, Object> parsedData = (Map<String, Object>)JSON.deserializeUntyped(jsonString);
            system.debug('##mappy: ' + parsedData);
            Map<String, Object> cmt_map = new Map<String, Object>();
            cmt_map.put('Mapping__c', String.valueOf(parsedData.get('mapping')));
            cmt_map.put('sObject__c', parsedData.get('sObjectName'));
            cmt_map.put('Template_Name__c', parsedData.get('templateName'));
            cmt_map.put('Template_Id__c', parsedData.get('templateId'));

            String cmtName = String.valueOf(parsedData.get('cmtName'));

            String recordName = 'PDFTron_Template_Mapping.' + cmtName;

            system.debug('### rec name: '+recordName);

            PDFTron_CMT_Helper.createUpdateMetadata(recordName, recordName, cmt_map);
            return 'Done!';
        } catch(Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
  }

  @AuraEnabled(Cacheable=true) 
  public static List<sobject> queryValuesFromRecord(String recordId, String objectName, List<String> fields) {
      String recId = recordId;
      String query = 'SELECT ';
      for(String field : fields) {
          query += field + ', ';
      }

      query = query.substring(0, query.length() - 2);
      query += ' ';
      query += 'FROM ' + objectName + ' ';
      query += 'WHERE Id = :recId';

      List<sobject> sobjlist = Database.query(query);

      return sobjlist;
  }

    @AuraEnabled(cacheable=true)
    public static List<String> getSObjects(){
        try {
            List<string> sObjectList = new List<string>();

            for(Schema.SObjectType objTyp : Schema.getGlobalDescribe().Values()) {
            String name = objTyp.getDescribe().getName();
            // Exclude all the unwanted Sobjects e.g. History, Share etc..
                if((!name.containsignorecase('history') && !name.containsignorecase('tag')&&
                    !name.containsignorecase('share') && !name.containsignorecase('feed')) || 
                    name.toLowerCase().right(3) ==  '__c') {      
                        sObjectList.add(name);
                }
            }

            sObjectList.sort();
            return sObjectList;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled(Cacheable=true)
    public static List<String> getObjectFields(String objectName){
        try {
            SObjectType objectType = Schema.getGlobalDescribe().get(objectName);
            List<String> result = new List<String>();
            for(Schema.SObjectField field : objectType.getDescribe().fields.getMap().values()) {
                result.add(field + '');
            } 
            result.sort();
            return result;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

  @AuraEnabled(Cacheable=true)
    public static List<LookupSearchResult> searchSOSL(String searchTerm, List<String> selectedIds) {
        // Prepare query paramters
        searchTerm += '*';

        // Execute search query
        List<List<SObject>> searchResults = [
            FIND :searchTerm
            IN ALL FIELDS
            RETURNING
                Account(Id, Name, BillingCity WHERE id NOT IN :selectedIds),
                Opportunity(Id, Name, StageName WHERE id NOT IN :selectedIds),
                Contact(Id, FirstName, LastName WHERE id NOT IN :selectedIds)
            LIMIT :MAX_RESULTS
        ];

        system.debug(searchResults);

        // Prepare results
        List<LookupSearchResult> results = new List<LookupSearchResult>();

        // Extract Accounts & convert them into LookupSearchResult
        String accountIcon = 'standard:account';
        Account[] accounts = (List<Account>) searchResults[0];
        for (Account account : accounts) {
            String subtitle = account.BillingCity == null ? 'Account' : 'Account • ' + account.BillingCity;
            results.add(new LookupSearchResult(account.Id, 'Account', accountIcon, account.Name, subtitle));
        }

        // Extract Opportunities & convert them into LookupSearchResult
        String opptyIcon = 'standard:opportunity';
        Opportunity[] opptys = (List<Opportunity>) searchResults[1];
        for (Opportunity oppty : opptys) {
            results.add(
                new LookupSearchResult(
                    oppty.Id,
                    'Opportunity',
                    opptyIcon,
                    oppty.Name,
                    'Opportunity • ' + oppty.StageName
                )
            );
        }

        // Extract Opportunities & convert them into LookupSearchResult
        String contactIcon = 'standard:contact';
        Contact[] contacts = (List<Contact>) searchResults[2];
        for (Contact con : contacts) {
            results.add(
                new LookupSearchResult(
                    con.Id,
                    'Contact',
                    contactIcon,
                    con.FirstName + ' ' + con.LastName,
                    'Contact'
                )
            );
        }

        // Optionnaly sort all results on title
        results.sort();

        return results;
    }

  public static String getFileLogo(String extension) {
    String logo = 'doctype:unknown';

    if (extension == 'pdf') {
      logo = 'doctype:pdf';
    } else if (extension == 'docx' || extension == 'doc') {
      logo = 'doctype:word';
    } else if (extension == 'xlsx' || extension == 'xls') {
      logo = 'doctype:excel';
    } else if (
      extension == 'tif' ||
      extension == 'jpg' ||
      extension == 'jpeg' ||
      extension == 'png'
    ) {
      logo = 'doctype:image';
    }
    return logo;
  }

  //only process blobs from below file formats
  public static Boolean checkFileExtension(String extension) {
    return supportedFileFormats.contains(extension.toLowerCase()); //compare set of valid extensions with lower case input string
  }

  //take long value and output readable string
  public static String convertBytesToFormattedString(Long Value) {
    if (Value < 1024) {
      //no conversion needed
      return string.valueOf(Value) + ' Bytes';
    } else if (Value >= 1024 && Value < (1024 * 1024)) {
      //KB
      Decimal kb = Decimal.valueOf(Value);
      kb = kb.divide(1024, 2);
      return string.valueOf(kb) + ' KB';
    } else if (Value >= (1024 * 1024) && Value < (1024 * 1024 * 1024)) {
      //MB
      Decimal mb = Decimal.valueOf(Value);
      mb = mb.divide((1024 * 1024), 2);
      return string.valueOf(mb) + ' MB';
    } else {
      //GB
      Decimal gb = Decimal.valueOf(Value);
      gb = gb.divide((1024 * 1024 * 1024), 2);
      return string.valueOf(gb) + ' GB';
    }
  }

  @AuraEnabled
    public static String getResourceURL(String resourceName){
        System.debug(resourceName);
        // Fetching the resource
        List<StaticResource> resourceList= [SELECT Name, NamespacePrefix, SystemModStamp FROM StaticResource WHERE Name = :resourceName];
        System.debug(resourceList);
        // Checking if the result is returned or not
        if(resourceList.size() == 1){

           // Getting namespace
           String namespace = resourceList[0].NamespacePrefix;
           // Resource URL
           System.debug(namespace);
           System.debug('/resource/' + resourceList[0].SystemModStamp.getTime() + '/' + (namespace != null && namespace != '' ? namespace + '__' : '') + resourceName);

           return '/resource/' + resourceList[0].SystemModStamp.getTime() + '/' + (namespace != null && namespace != '' ? namespace + '__' : '') + resourceName; 
        }
        
        return '';
    }

  public class ContentVersionWrapper {
    @AuraEnabled
    public String name { get; set; }
    @AuraEnabled
    public String body { get; set; }
    @AuraEnabled
    public ContentVersion cv;

    public ContentVersionWrapper(ContentVersion contentVer, Boolean encode) {
      this.cv = contentVer;
      this.name = contentVer.Title + '.' + contentVer.FileExtension;
      if (encode) {
        this.body = EncodingUtil.base64Encode(contentVer.VersionData);
      }
    }
  }

  public class PDFTron_ContentVersionPayload {
    public String title { get; set; }
    public String filename { get; set; }
    public String base64Data { get; set; }
    public String contentDocumentId { get; set; }

    public PDFTron_ContentVersionPayload(String json) {
      PDFTron_ContentVersionPayload pl = (PDFTron_ContentVersionPayload) System.JSON.deserialize(
        json,
        PDFTron_ContentVersionPayload.class
      );
      this.title = pl.title;
      this.filename = pl.filename;
      this.base64Data = pl.base64Data;
      this.contentDocumentId = pl.contentDocumentId;
    }
  }

  public class PDFTronException extends Exception {
  }
}
