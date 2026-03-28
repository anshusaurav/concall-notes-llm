# Design Document

## Overview

The announcement processor feature will extend the existing ConferenceCallNotes class to handle announcement documents alongside conference calls. The design leverages the existing PDF processing, AI analysis, and Firestore integration infrastructure while adding announcement-specific processing methods.

The core approach mirrors the conference call processing workflow: extract PDF content from announcement links, generate AI-powered summaries using industry-specific prompts, and store the processed results back to Firestore.

## Architecture

### High-Level Flow
1. **Document Processing Entry Point**: The main `readAllFilingDocuments()` method will be enhanced to call both `processConcallsDocument()` and `processAnnouncementDocument()` for each document
2. **Announcement Processing**: New `processAnnouncementDocument()` method will handle announcement-specific logic
3. **Batch Processing**: New `processAnnouncements()` method will iterate through announcement lists
4. **Individual Processing**: New `processSingleAnnouncement()` method will handle individual announcement processing
5. **Storage Update**: Enhanced `updateDocumentInFirestore()` method will handle both conference calls and announcements

### Data Flow
```
Firestore Document → processAnnouncementDocument() → processAnnouncements() → processSingleAnnouncement() → PDF Processing → AI Analysis → Firestore Update
```

## Components and Interfaces

### New Methods

#### `processAnnouncementDocument(doc)`
- **Purpose**: Main entry point for processing announcements in a document
- **Input**: Firestore document object
- **Responsibilities**:
  - Extract announcement list from `documents.Announcements` field
  - Validate industry prompt availability
  - Call batch announcement processing
  - Update Firestore with processed results
- **Error Handling**: Log errors and continue processing other documents

#### `processAnnouncements(announcementList, industryPrompt)`
- **Purpose**: Process a list of announcements with rate limiting
- **Input**: Array of announcement objects, industry prompt string
- **Output**: Array of processed announcement objects
- **Responsibilities**:
  - Iterate through announcements (limit to first 16 items)
  - Skip already processed announcements
  - Handle missing PDF links gracefully
  - Call individual announcement processing
- **Rate Limiting**: Process maximum 16 announcements per document (same as conference calls)

#### `processSingleAnnouncement(announcement, industryPrompt)`
- **Purpose**: Process a single announcement document
- **Input**: Announcement object, industry prompt string
- **Output**: Processed announcement object with summary and markdown
- **Responsibilities**:
  - Fetch PDF from announcement link
  - Extract text content
  - Generate AI summary using existing Gemini integration
  - Return processed announcement with metadata

### Enhanced Methods

#### `readAllFilingDocuments()`
- **Enhancement**: Add call to `processAnnouncementDocument()` after `processConcallsDocument()`
- **Logic**: Process both types of documents for each Firestore document

#### `updateDocumentInFirestore(docId, updatedConCalls, updatedAnnouncements)`
- **Enhancement**: Accept optional `updatedAnnouncements` parameter
- **Logic**: Update both `documents.Concalls` and `documents.Announcements` fields when provided

## Data Models

### Announcement Object Structure

#### Input Announcement Object
```javascript
{
  link: "https://example.com/announcement.pdf",
  title: "Quarterly Results Announcement",
  date: "2024-01-15",
  // ... other existing fields
}
```

#### Processed Announcement Object
```javascript
{
  link: "https://example.com/announcement.pdf",
  title: "Quarterly Results Announcement", 
  date: "2024-01-15",
  summary: "Generated summary text...",
  markdownOutput: "# Analysis\n\nDetailed markdown analysis...",
  isProcessed: true,
  processingDate: "2024-01-15T10:30:00.000Z",
  textLength: 15420,
  // ... other existing fields
}
```

#### Error Case Announcement Object
```javascript
{
  link: "https://example.com/announcement.pdf",
  title: "Quarterly Results Announcement",
  date: "2024-01-15", 
  isProcessed: false,
  processingError: "Failed to fetch PDF: Network timeout",
  processingDate: "2024-01-15T10:30:00.000Z",
  // ... other existing fields
}
```

### Firestore Document Structure
```javascript
{
  name: "Company Name",
  companyCode: "123",
  industryLink: "industry-link",
  documents: {
    Concalls: [...], // existing conference calls
    Announcements: [...] // new announcements array
  },
  lastProcessed: "2024-01-15T10:30:00.000Z"
}
```

## Error Handling

### PDF Processing Errors
- **Network Timeouts**: Log error, mark announcement as failed, continue processing
- **Invalid PDF Format**: Log error, mark announcement as failed, continue processing
- **Missing PDF Links**: Log warning, mark announcement with appropriate error message

### AI Processing Errors
- **API Rate Limits**: Use existing Gemini key rotation and retry logic
- **API Quota Exceeded**: Use existing key blocking and rotation mechanism
- **Invalid Responses**: Use existing fallback parsing methods

### Firestore Errors
- **Update Failures**: Log error, continue processing other documents
- **Connection Issues**: Use existing connection testing and error handling

## Testing Strategy

### Unit Testing
- Test `processAnnouncementDocument()` with various document structures
- Test `processAnnouncements()` with different announcement list sizes
- Test `processSingleAnnouncement()` with valid and invalid PDF links
- Test error handling for each processing method

### Integration Testing
- Test end-to-end announcement processing workflow
- Test Firestore integration with announcement updates
- Test Gemini API integration with announcement content
- Test processing of documents with both conference calls and announcements

### Edge Case Testing
- Documents with only announcements (no conference calls)
- Documents with only conference calls (no announcements)
- Documents with empty announcement arrays
- Documents with malformed announcement objects
- Network failures during PDF fetching
- Gemini API failures and recovery

## Performance Considerations

### Rate Limiting
- Process maximum 16 announcements per document (consistent with conference calls)
- Use existing Gemini API key rotation to distribute load
- Implement same delay mechanisms between API calls

### Memory Management
- Process announcements sequentially to avoid memory spikes
- Use existing PDF buffer handling for memory efficiency
- Clean up temporary data after each announcement

### Scalability
- Leverage existing multi-key Gemini API setup
- Use existing Firestore batch update patterns
- Maintain existing error recovery and retry mechanisms

## Security Considerations

### Data Validation
- Validate announcement object structure before processing
- Sanitize PDF URLs before fetching
- Use existing environment variable validation for API keys

### API Security
- Use existing Gemini API key management and rotation
- Maintain existing rate limiting and quota management
- Use existing error logging without exposing sensitive data

### Firestore Security
- Use existing Firebase service account authentication
- Maintain existing document access patterns
- Use existing update validation and error handling