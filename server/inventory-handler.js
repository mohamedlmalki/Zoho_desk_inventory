// In server/inventory-handler.js

const { makeApiCall, parseError, createJobId, readProfiles } = require('./utils');

let activeJobs = {};

const setActiveJobs = (jobsObject) => {
  activeJobs = jobsObject;
};

const interruptibleSleep = (ms, jobId) => {
    return new Promise(resolve => {
        if (ms <= 0) return resolve();
        const interval = 100;
        let elapsed = 0;
        const timerId = setInterval(() => {
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') {
                clearInterval(timerId);
                return resolve();
            }
            elapsed += interval;
            if (elapsed >= ms) {
                clearInterval(timerId);
                resolve();
            }
        }, interval);
    });
};

const handleGetOrgDetails = async (socket, data) => {
    try {
        const { activeProfile } = data;
        if (!activeProfile || !activeProfile.inventory || !activeProfile.inventory.orgId) {
            throw new Error('Inventory profile or orgId not configured.');
        }
        const orgId = activeProfile.inventory.orgId;
        const response = await makeApiCall('get', `/v1/organizations/${orgId}`, null, activeProfile, 'inventory');

        if (response.data && response.data.organization) {
            socket.emit('orgDetailsResult', { success: true, data: response.data.organization });
        } else {
            throw new Error('Organization not found for this profile.');
        }
    } catch (error) {
        const { message } = parseError(error);
        socket.emit('orgDetailsResult', { success: false, error: message });
    }
};

const handleUpdateOrgDetails = async (socket, data) => {
    try {
        const { displayName, activeProfile } = data;
        if (!activeProfile || !activeProfile.inventory || !activeProfile.inventory.orgId) {
            throw new Error('Inventory profile or orgId not configured.');
        }
        
        const orgId = activeProfile.inventory.orgId;
        
        const getResponse = await makeApiCall('get', `/v1/organizations/${orgId}`, null, activeProfile, 'inventory');
        const organization = getResponse.data.organization;

        if (!organization) {
            throw new Error("Could not find the organization to update.");
        }

        const monthMap = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
        
        const updateData = {
            name: organization.name,
            contact_name: displayName,
            email: organization.email,
            is_logo_uploaded: organization.is_logo_uploaded,
            fiscal_year_start_month: monthMap[organization.fiscal_year_start_month],
            time_zone: organization.time_zone,
            language_code: organization.language_code,
            date_format: organization.date_format,
            field_separator: organization.field_separator,
            org_address: organization.org_address,
            remit_to_address: organization.remit_to_address,
            phone: organization.phone,
            fax: organization.fax,
            website: organization.website,
            currency_id: organization.currency_id,
            companyid_label: organization.company_id_label,
            companyid_value: organization.company_id_value,
            taxid_label: organization.tax_id_label,
            taxid_value: organization.tax_id_value,
            address: {
                street_address1: organization.address?.street_address1 || "",
                street_address2: organization.address?.street_address2 || "",
                city: organization.address?.city || "",
                state: organization.address?.state || "",
                country: organization.address?.country || "",
                zip: organization.address?.zip || ""
            },
            custom_fields: organization.custom_fields || []
        };
        
        const response = await makeApiCall('put', `/v1/organizations/${orgId}`, updateData, activeProfile, 'inventory');
        
        if (response.data && response.data.organization) {
            const updatedOrganization = response.data.organization;
            if (updatedOrganization.contact_name === displayName) {
                socket.emit('updateOrgDetailsResult', { success: true, data: updatedOrganization });
            } else {
                socket.emit('updateOrgDetailsResult', {
                    success: false,
                    error: 'API reported success, but the name was not updated. This may be a permissions issue.',
                    fullResponse: response.data
                });
            }
        } else {
            throw new Error('Invalid response structure from Zoho API after update.');
        }

    } catch (error) {
        const { message, fullResponse } = parseError(error);
        socket.emit('updateOrgDetailsResult', { success: false, error: message, fullResponse });
    }
};

const handleStartBulkInvoice = async (socket, data) => {
    const { emails, subject, body, delay, selectedProfileName, activeProfile } = data;
    const jobId = createJobId(socket.id, selectedProfileName, 'invoice');
    activeJobs[jobId] = { status: 'running' };

    try {
        if (!activeProfile || !activeProfile.inventory) {
            throw new Error('Inventory profile configuration is missing.');
        }

        for (let i = 0; i < emails.length; i++) {
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;
            while (activeJobs[jobId]?.status === 'paused') {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            if (i > 0 && delay > 0) await interruptibleSleep(delay * 1000, jobId);
            if (!activeJobs[jobId] || activeJobs[jobId].status === 'ended') break;

            const email = emails[i];
            const rowNumber = i + 1;
            let contactResponsePayload = {};
            let invoiceResponsePayload = {};
            let contactPersonsForInvoice = [];

            socket.emit('invoiceResult', { rowNumber, email, stage: 'contact', details: 'Searching for contact...', profileName: selectedProfileName });
            
            const contactName = email.split('@')[0];
            let contactId;

            try {
                const searchResponse = await makeApiCall('get', `/v1/contacts?email=${encodeURIComponent(email)}`, null, activeProfile, 'inventory');
                if (searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
                    const existingContact = searchResponse.data.contacts[0];
                    contactId = existingContact.contact_id;
                    
                    // This part is now more efficient, like your backup
                    if (Array.isArray(existingContact.contact_persons)) {
                        contactPersonsForInvoice = existingContact.contact_persons.map(p => ({ contact_person_id: p.contact_person_id }));
                    }
                    contactResponsePayload = { success: true, fullResponse: searchResponse.data };

                } else {
                    socket.emit('invoiceResult', { rowNumber, email, stage: 'contact', details: 'Contact not found, creating...', profileName: selectedProfileName });
                    const newContactData = { contact_name: contactName, contact_persons: [{ email: email, is_primary_contact: true }] };
                    const createResponse = await makeApiCall('post', '/v1/contacts', newContactData, activeProfile, 'inventory');
                    const newContact = createResponse.data.contact;
                    contactId = newContact.contact_id;
                    if (Array.isArray(newContact.contact_persons)) {
                       contactPersonsForInvoice = newContact.contact_persons.map(p => ({ contact_person_id: p.contact_person_id }));
                    }
                    contactResponsePayload = { success: true, fullResponse: createResponse.data };
                }
                socket.emit('invoiceResult', { rowNumber, email, stage: 'invoice', details: 'Contact processed. Creating invoice...', contactResponse: contactResponsePayload, profileName: selectedProfileName });
            
            } catch (contactError) {
                const { message, fullResponse } = parseError(contactError);
                contactResponsePayload = { success: false, fullResponse };
                socket.emit('invoiceResult', { rowNumber, email, stage: 'complete', success: false, details: `Contact Error: ${message}`, contactResponse: contactResponsePayload, profileName: selectedProfileName });
                continue;
            }

            let invoiceId;
            try {
                const invoiceData = {
                    customer_id: contactId,
                    contact_persons: contactPersonsForInvoice.map(p => p.contact_person_id),
                    line_items: [{ name: "Default Service", rate: 100.00, quantity: 1 }],
                };
                const invoiceResponse = await makeApiCall('post', '/v1/invoices', invoiceData, activeProfile, 'inventory');
                invoiceId = invoiceResponse.data.invoice.invoice_id;
                invoiceResponsePayload = { success: true, fullResponse: invoiceResponse.data };
                socket.emit('invoiceResult', { rowNumber, email, stage: 'invoice', details: 'Invoice created. Sending email...', invoiceResponse: invoiceResponsePayload, profileName: selectedProfileName });

            } catch (invoiceError) {
                const { message, fullResponse } = parseError(invoiceError);
                invoiceResponsePayload = { success: false, fullResponse };
                socket.emit('invoiceResult', { rowNumber, email, stage: 'complete', success: false, details: `Invoice Creation Error: ${message}`, contactResponse: contactResponsePayload, invoiceResponse: invoiceResponsePayload, profileName: selectedProfileName });
                continue;
            }
            
            try {
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const emailData = { 
                    to_mail_ids: [email], 
                    subject: subject, 
                    body: body
                };
                
                const emailApiResponse = await makeApiCall('post', `/v1/contacts/${contactId}/email`, emailData, activeProfile, 'inventory');
                
                const emailSendResponsePayload = { success: true, fullResponse: emailApiResponse.data };
                
                socket.emit('invoiceResult', { 
                    rowNumber, email, stage: 'complete', success: true, 
                    details: `Email sent for Invoice #${invoiceResponsePayload.fullResponse?.invoice?.invoice_number}.`, 
                    invoiceNumber: invoiceResponsePayload.fullResponse?.invoice?.invoice_number,
                    emailResponse: emailSendResponsePayload,
                    profileName: selectedProfileName
                });

            } catch (emailError) {
                const { message, fullResponse } = parseError(emailError);
                const emailSendResponsePayload = { success: false, fullResponse };
                 socket.emit('invoiceResult', { 
                    rowNumber, email, stage: 'complete', success: false, 
                    details: `Email Send Error: ${message}`, 
                    emailResponse: emailSendResponsePayload,
                    profileName: selectedProfileName
                });
            }
        }
    } catch (error) {
        socket.emit('bulkError', { message: error.message || 'A critical server error occurred.', profileName: selectedProfileName, jobType: 'invoice' });
    } finally {
        if (activeJobs[jobId]) {
            const finalStatus = activeJobs[jobId].status;
            if (finalStatus === 'ended') {
                socket.emit('bulkEnded', { profileName: selectedProfileName, jobType: 'invoice' });
            } else {
                socket.emit('bulkComplete', { profileName: selectedProfileName, jobType: 'invoice' });
            }
            delete activeJobs[jobId];
        }
    }
};

const handleSendSingleInvoice = async (data) => {
    const { email, subject, body, selectedProfileName } = data;
    if (!email || !subject || !body || !selectedProfileName) {
        return { success: false, error: 'Missing required fields.' };
    }
    const profiles = readProfiles();
    const activeProfile = profiles.find(p => p.profileName === selectedProfileName);
    
    if (!activeProfile || !activeProfile.inventory) {
        return { success: false, error: 'Inventory profile not configured.' };
    }

    let fullResponse = {};

    try {
        const searchResponse = await makeApiCall('get', `/v1/contacts?email=${encodeURIComponent(email)}`, null, activeProfile, 'inventory');
        let contactId;
        let contactPersonsForInvoice = [];

        if (searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
            contactId = searchResponse.data.contacts[0].contact_id;
            fullResponse.contact = { status: 'found', data: searchResponse.data };
        } else {
            const contactName = email.split('@')[0];
            const newContactData = { contact_name: contactName, contact_persons: [{ email: email, is_primary_contact: true }] };
            const createResponse = await makeApiCall('post', '/v1/contacts', newContactData, activeProfile, 'inventory');
            contactId = createResponse.data.contact.contact_id;
            fullResponse.contact = { status: 'created', data: createResponse.data };
        }

        const contactDetailsResponse = await makeApiCall('get', `/v1/contacts/${contactId}`, null, activeProfile, 'inventory');
        const contact = contactDetailsResponse.data.contact;
        if (Array.isArray(contact.contact_persons) && contact.contact_persons.length > 0) {
            contactPersonsForInvoice = contact.contact_persons.map(p => p.contact_person_id);
        } else {
            throw new Error('Could not find a contact person for the contact.');
        }

        const invoiceData = {
            customer_id: contactId,
            contact_person_ids: contactPersonsForInvoice,
            line_items: [{ name: "Service", description: "General service provided", rate: 0.00, quantity: 1 }],
        };
        const invoiceResponse = await makeApiCall('post', '/v1/invoices', invoiceData, activeProfile, 'inventory');
        const invoiceId = invoiceResponse.data.invoice.invoice_id;
        fullResponse.invoice = invoiceResponse.data;

        const emailData = {
            subject: subject,
            body: body,
            send_from_org_email_id: false,
            to_mail_ids: [email]
        };
        
        const emailApiResponse = await makeApiCall('post', `/v1/contacts/${contactId}/email`, emailData, activeProfile, 'inventory');
        fullResponse.email = emailApiResponse.data;
        
        return { 
            success: true, 
            message: `Invoice ${invoiceResponse.data.invoice.invoice_number} created and email sent successfully.`,
            fullResponse: fullResponse
        };

    } catch (error) {
        const { message, fullResponse: errorResponse } = parseError(error);
        fullResponse.error = errorResponse;
        return { success: false, error: message, fullResponse: fullResponse };
    }
};

module.exports = {
    setActiveJobs,
    handleStartBulkInvoice,
    handleGetOrgDetails,
    handleUpdateOrgDetails,
    handleSendSingleInvoice
};
