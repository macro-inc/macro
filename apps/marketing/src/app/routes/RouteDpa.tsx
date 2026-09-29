import type { Component } from 'solid-js';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { setPageSeo } from '../utils/utilSeo';
import './RouteDpa.css';
import './RouteLegal.css';

/**
 * Macro's Data Protection Agreement, transcribed from MacroDPA.docx (version
 * August 2026). The wording is the executed document's and the presentation is
 * ours, with one deliberate correction: clause 1.7 reads "all l and regulations"
 * in the source, and is published here as "all laws and regulations".
 *
 * Formatted to sit alongside /terms and /privacy: their 56rem measure, their
 * paragraph metrics, and a solid rule above each section heading. Clause
 * numbers are CSS counters following the Word numbering scheme (1, 1.1, (a)),
 * set inline at the head of each clause so a numbered clause reads as one
 * paragraph. The table of contents is a navigation aid built only from the
 * document's own headings.
 *
 * The document's cover page — its Key Terms, Schedules table and signature
 * blocks — is deliberately not published here. Clauses that cite it (1.1, 1.9,
 * 1.10, 1.12, 1.21 and the opening paragraph) therefore refer to a document
 * that lives elsewhere.
 */

// Body sections, in document order. Used for the table of contents and to keep
// each section's number in one place (it feeds the CSS counter prefix).
const SECTIONS = [
  'Definitions',
  'Scope and Duration',
  'Processing of Personal Data',
  'Sub-Processors',
  'Security',
  'Data Protection Impact Assessment',
  'Data Subject Requests',
  'Data Return or Deletion',
  'Audits',
  'Cross-Border Transfers/Region-Specific Terms',
];

const SCHEDULES = [
  'Schedule 1: Subject Matter and Details of Processing',
  'Schedule 2: Technical and Organizational Measures',
  'Schedule 3: Cross-Border Transfer Mechanisms',
  'Schedule 4: Region-Specific Terms',
];

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Contents entries, in page order.
const TOC = [
  ...SECTIONS.map((title) => ({ title, id: slug(title) })),
  ...SCHEDULES.map((title) => ({ title, id: slug(title) })),
];

// Filling the two columns top-to-bottom by an explicit row count keeps both
// starting on the same line — CSS multi-column balances by height instead,
// which left the second column's first entry off by a line.
const TOC_ROWS = Math.ceil(TOC.length / 2);

export const RouteDpa: Component = () => {
  setPageSeo({
    title: 'Data Processing Agreement · Macro',
    description:
      "Macro's Data Protection Agreement (DPA), covering how Macro processes customer personal data as a processor, including security measures, sub-processors, audits, and cross-border transfers.",
    path: '/dpa',
  });

  return (
    <>
      <main class="dpa">
        <div class="dpa-doc">
          {/* Wordmark eyebrow, title, then the version line — the same header
              shape /terms and /privacy get from UtilPlainText. */}
          <p class="dpa-eyebrow">Macro</p>
          <h1 class="dpa-title">DPA</h1>
          <p class="dpa-version">Version August 2026</p>

          {/* Macro's own notice, not part of the contract. The class carries no
              styling of its own; it exists so the page can be checked against
              MacroDPA.docx with the notice excluded. */}
          <p class="dpa-note">
            The following is a reference to the body of our Data Protection
            Addendum (DPA) that acts as a supplement for our Cloud Terms of
            Service and Enterprise Agreements where required by applicable data
            protection laws. Please contact{' '}
            <a href="mailto:sales@macro.com">sales@macro.com</a> for a
            signature-friendly copy and more information including the Cover
            Page.
          </p>

          <p class="dpa-lede">
            This Data Protection Addendum (“<strong>DPA</strong>”) is an
            Attachment to the Agreement. Customer and Provider enter into this
            DPA by executing a DPA Cover Page. Capitalized terms not defined in
            this DPA are defined in the Agreement or DPA Cover Page.
          </p>

          <ol
            class="dpa-toc"
            style={{ 'grid-template-rows': `repeat(${TOC_ROWS}, auto)` }}
          >
            {TOC.map((entry) => (
              <li>
                <a href={`#${entry.id}`}>{entry.title}</a>
              </li>
            ))}
          </ol>

          {/* 1. Definitions ------------------------------------------------ */}

          <section
            class="dpa-section"
            id={slug(SECTIONS[0])}
            style={{ '--section-num': '"1"' }}
          >
            <h2 class="dpa-heading">Definitions</h2>
            <ol class="dpa-clauses">
              <li class="dpa-clause">
                “<strong>Agreement</strong>” means the Agreement between
                Customer and Provider incorporating the Cloud Terms which is
                specified on the DPA Cover Page.
              </li>
              <li class="dpa-clause">
                “<strong>Audit</strong>” and “<strong>Audit Parameters</strong>”
                are defined in Section 9.3 below.
              </li>
              <li class="dpa-clause">
                “<strong>Audit Report</strong>” is defined in Section 9.2 below.
              </li>
              <li class="dpa-clause">
                “<strong>Controller</strong>” means the natural or legal person,
                public authority, agency or other body which, alone or jointly
                with others, determines the purposes and means of Processing of
                Personal Data.
              </li>
              <li class="dpa-clause">
                “<strong>Customer Instructions</strong>” is defined in Section
                3.1 below.
              </li>
              <li class="dpa-clause">
                “<strong>Customer Personal Data</strong>” means Personal Data in
                Customer Data (as defined in the Agreement).
              </li>
              <li class="dpa-clause">
                <p>
                  “<strong>Data Protection Laws</strong>” means all laws and
                  regulations applicable to the Processing of Customer Personal
                  Data under the Agreement, including, as applicable: (i) the
                  California Consumer Privacy Act, as amended by the California
                  Privacy Rights Act, and any binding regulations promulgated
                  thereunder (“<strong>CCPA</strong>”), (ii) the General Data
                  Protection Regulation (Regulation (EU) 2016/679) (“
                  <strong>EU GDPR</strong>” or “<strong>GDPR</strong>”), (iii)
                  the Swiss Federal Act on Data Protection (“
                  <strong>FADP</strong>”), (iv) the EU GDPR as it forms part of
                  the law of England and Wales by virtue of section 3 of the
                  European Union (Withdrawal) Act 2018 (the “
                  <strong>UK GDPR</strong>”) and
                </p>
                <p>
                  (v) the UK Data Protection Act 2018; in each case, as updated,
                  amended or replaced from time to time.
                </p>
              </li>
              <li class="dpa-clause">
                “<strong>Data Subject</strong>” means the identified or
                identifiable natural person to whom Customer Personal Data
                relates.
              </li>
              <li class="dpa-clause">
                “<strong>DPA Effective Date</strong>” is specified on the DPA
                Cover Page.
              </li>
              <li class="dpa-clause">
                “<strong>DPA Cover Page</strong>” means a separate document
                executed by Customer and Provider which causes this DPA to
                become an Attachment to their Agreement.
              </li>
              <li class="dpa-clause">
                “<strong>EEA</strong>” means European Economic Area.
              </li>
              <li class="dpa-clause">
                “<strong>Key Terms</strong>” means Agreement, DPA Effective Date
                and Sub-Processor List as specified by the parties on the DPA
                Cover Page.
              </li>
              <li class="dpa-clause">
                “<strong>Personal Data</strong>” means information about an
                identified or identifiable natural person or which otherwise
                constitutes “personal data”, “personal information”, “personally
                identifiable information” or similar terms as defined in Data
                Protection Laws.
              </li>
              <li class="dpa-clause">
                “<strong>Processing</strong>” and inflections thereof refer to
                any operation or set of operations that is performed on Personal
                Data or on sets of Personal Data, whether or not by automated
                means, such as collection, recording, organization, structuring,
                storage, adaptation or alteration, retrieval, consultation, use,
                disclosure by transmission, dissemination or otherwise making
                available, alignment or combination, restriction, erasure or
                destruction.
              </li>
              <li class="dpa-clause">
                “<strong>Processor</strong>” means a natural or legal person,
                public authority, agency or other body which Processes Personal
                Data on behalf of the Controller.
              </li>
              <li class="dpa-clause">
                “<strong>Restricted Transfer</strong>” means: (i) where EU GDPR
                applies, a transfer of Customer Personal Data from the EEA to a
                country outside the EEA that is not subject to an adequacy
                determination, (ii) where UK GDPR applies, a transfer of
                Customer Personal Data from the United Kingdom to any other
                country that is not subject to an adequacy determination or
                (iii) where FADP applies, a transfer of Customer Personal Data
                from Switzerland to any other country that is not subject to an
                adequacy determination.
              </li>
              <li class="dpa-clause">
                <p>
                  “<strong>Schedules</strong>” means one or more schedules
                  incorporated by the parties in their DPA Cover Page. The
                  default Schedules for this DPA are:
                </p>
                <div class="dpa-table-wrap">
                  <table class="dpa-table">
                    <tbody>
                      <tr>
                        <th scope="row">Schedule 1</th>
                        <td>Subject Matter and Details of Processing</td>
                      </tr>
                      <tr>
                        <th scope="row">Schedule 2</th>
                        <td>Technical and Organizational Measures</td>
                      </tr>
                      <tr>
                        <th scope="row">Schedule 3</th>
                        <td>Cross-Border Transfer Mechanisms</td>
                      </tr>
                      <tr>
                        <th scope="row">Schedule 4</th>
                        <td>Region-Specific Terms</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </li>
              <li class="dpa-clause">
                “<strong>Security Incident</strong>” means any breach of
                security that leads to the accidental or unlawful destruction,
                loss, alteration, unauthorized disclosure of, or access to,
                Customer Personal Data being Processed by Provider.
              </li>
              <li class="dpa-clause">
                “<strong>Specified Notice Period</strong>” is 48 hours.
              </li>
              <li class="dpa-clause">
                “<strong>Sub-Processor</strong>” means any third party
                authorized by Provider to Process any Customer Personal Data.
              </li>
              <li class="dpa-clause">
                “<strong>Sub-Processor List</strong>” means the list of
                Provider’s Sub-Processors as identified or linked to on the DPA
                Cover Page.
              </li>
            </ol>
          </section>

          {/* 2. Scope and Duration ----------------------------------------- */}

          <section
            class="dpa-section"
            id={slug(SECTIONS[1])}
            style={{ '--section-num': '"2"' }}
          >
            <h2 class="dpa-heading">Scope and Duration</h2>
            <ol class="dpa-clauses">
              <li class="dpa-clause">
                <p class="dpa-clause-title">Roles of the Parties.</p>
                <p>
                  This DPA applies to Provider as a Processor of Customer
                  Personal Data and to Customer as a Controller or Processor of
                  Customer Personal Data.
                </p>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Scope of DPA.</p>
                <p>
                  This DPA applies to Provider’s Processing of Customer Personal
                  Data under the Agreement to the extent such Processing is
                  subject to Data Protection Laws. This DPA is governed by the
                  governing law of the Agreement unless otherwise required by
                  Data Protection Laws.
                </p>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Duration of DPA.</p>
                <p>
                  This DPA commences on the DPA Effective Date and terminates
                  upon expiration or termination of the Agreement (or, if later,
                  the date on which Provider has ceased all Processing of
                  Customer Personal Data).
                </p>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Order of Precedence.</p>
                <p>
                  In the event of any conflict or inconsistency among the
                  following documents, the order of precedence will be: (1) any
                  Standard Contractual Clauses or other measures to which the
                  parties have agreed in <u>Schedule 3</u> (Cross-Border
                  Transfer Mechanisms) or <u>Schedule 4</u> (Region-Specific
                  Terms), (2) this DPA and (3) the Agreement. To the fullest
                  extent permitted by Data Protection Laws, any claims brought
                  in connection with this DPA (including its Schedules) will be
                  subject to the terms and conditions, including, but not
                  limited to, the exclusions and limitations, set forth in the
                  Agreement.
                </p>
              </li>
            </ol>
          </section>

          {/* 3. Processing of Personal Data --------------------------------- */}

          <section
            class="dpa-section"
            id={slug(SECTIONS[2])}
            style={{ '--section-num': '"3"' }}
          >
            <h2 class="dpa-heading">Processing of Personal Data</h2>
            <ol class="dpa-clauses">
              <li class="dpa-clause">
                <p class="dpa-clause-title">Customer Instructions.</p>
                <ol class="dpa-clauses dpa-clauses--alpha">
                  <li class="dpa-clause">
                    Provider will Process Customer Personal Data as a Processor
                    only: (i) in accordance with Customer Instructions or (ii)
                    to comply with Provider’s obligations under applicable laws,
                    subject to any notice requirements under Data Protection
                    Laws.
                  </li>
                  <li class="dpa-clause">
                    “<strong>Customer Instructions</strong>” means: (i)
                    Processing to provide the Cloud Service and perform
                    Provider’s obligations in the Agreement (including this DPA)
                    and (ii) other reasonable documented instructions of
                    Customer consistent with the terms of the Agreement.
                  </li>
                  <li class="dpa-clause">
                    Details regarding the Processing of Customer Personal Data
                    by Provider are set forth in <u>Schedule 1</u> (Subject
                    Matter and Details of Processing).
                  </li>
                  <li class="dpa-clause">
                    Provider will notify Customer if it receives an instruction
                    that Provider reasonably determines infringes Data
                    Protection Laws (but Provider has no obligation to actively
                    monitor Customer’s compliance with Data Protection Laws).
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Confidentiality.</p>
                <ol class="dpa-clauses dpa-clauses--alpha">
                  <li class="dpa-clause">
                    Provider will protect Customer Personal Data in accordance
                    with its confidentiality obligations as set forth in the
                    Agreement.
                  </li>
                  <li class="dpa-clause">
                    Provider will ensure personnel who Process Customer Personal
                    Data either enter into written confidentiality agreements or
                    are subject to statutory obligations of confidentiality.
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Compliance with Laws.</p>
                <ol class="dpa-clauses dpa-clauses--alpha">
                  <li class="dpa-clause">
                    Provider and Customer will each comply with Data Protection
                    Laws in their respective Processing of Customer Personal
                    Data.
                  </li>
                  <li class="dpa-clause">
                    Customer will comply with Data Protection Laws in its
                    issuing of Customer Instructions to Provider. Customer will
                    ensure that it has established all necessary lawful bases
                    under Data Protection Laws to enable Provider to lawfully
                    Process Customer Personal Data for the purposes contemplated
                    by the Agreement (including this DPA), including, as
                    applicable, by obtaining all necessary consents from, and
                    giving all necessary notices to, Data Subjects.
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Changes to Laws.</p>
                <p>
                  The parties will work together in good faith to negotiate an
                  amendment to this DPA as either party reasonably considers
                  necessary to address the requirements of Data Protection Laws
                  from time to time.
                </p>
              </li>
            </ol>
          </section>

          {/* 4. Sub-Processors ---------------------------------------------- */}

          <section
            class="dpa-section"
            id={slug(SECTIONS[3])}
            style={{ '--section-num': '"4"' }}
          >
            <h2 class="dpa-heading">Sub-Processors</h2>
            <ol class="dpa-clauses">
              <li class="dpa-clause">
                <p class="dpa-clause-title">Use of Sub-Processors.</p>
                <ol class="dpa-clauses dpa-clauses--alpha">
                  <li class="dpa-clause">
                    Customer generally authorizes Provider to engage
                    Sub-Processors to Process Customer Personal Data. Customer
                    further agrees that Provider may engage its Affiliates as
                    Sub-Processors.
                  </li>
                  <li class="dpa-clause">
                    Provider will: (i) enter into a written agreement with each
                    Sub-Processor imposing data Processing and protection
                    obligations substantially the same as those set out in this
                    DPA and (ii) remain liable for compliance with the
                    obligations of this DPA and for any acts or omissions of a
                    Sub-Processor that cause Provider to breach any of its
                    obligations under this DPA.
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Sub-Processor List.</p>
                <p>
                  Provider will maintain an up-to-date list of its
                  Sub-Processors, including their functions and locations, as
                  specified in the Sub-Processor List.
                </p>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Notice of New Sub-Processors.</p>
                <p>
                  Provider may update the Sub-Processor List from time to time.
                  At least 30 days before any new Sub-Processor Processes any
                  Customer Personal Data, Provider will add such Sub-Processor
                  to the Sub-Processor List and notify Customer through email or
                  other means specified on the DPA Cover Page.
                </p>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Objection to New Sub-Processors.</p>
                <ol class="dpa-clauses dpa-clauses--alpha">
                  <li class="dpa-clause">
                    If, within 30 days after notice of a new Sub-Processor,
                    Customer notifies Provider in writing that Customer objects
                    to Provider’s appointment of such new Sub-Processor based on
                    reasonable data protection concerns, the parties will
                    discuss such concerns in good faith.
                  </li>
                  <li class="dpa-clause">
                    If the parties are unable to reach a mutually agreeable
                    resolution to Customer’s objection to a new Sub-Processor,
                    Customer, as its sole and exclusive remedy, may terminate
                    the Order for the affected Cloud Service for convenience and
                    Provider will refund any prepaid, unused fees for the
                    terminated portion of the Subscription Term.
                  </li>
                </ol>
              </li>
            </ol>
          </section>

          {/* 5. Security ---------------------------------------------------- */}

          <section
            class="dpa-section"
            id={slug(SECTIONS[4])}
            style={{ '--section-num': '"5"' }}
          >
            <h2 class="dpa-heading">Security</h2>
            <ol class="dpa-clauses">
              <li class="dpa-clause">
                <p class="dpa-clause-title">Security Measures.</p>
                <p>
                  Provider will implement and maintain reasonable and
                  appropriate technical and organizational measures, procedures
                  and practices, as appropriate to the nature of the Customer
                  Personal Data, that are designed to protect the security,
                  confidentiality, integrity and availability of Customer
                  Personal Data and protect against Security Incidents, in
                  accordance with Provider’s Security Measures referenced in the
                  Agreement and as further described in <u>Schedule 2</u>{' '}
                  (Technical and Organizational Measures). Provider will
                  regularly monitor its compliance with its Security Measures
                  and <u>Schedule 2</u> (Technical and Organizational Measures).
                </p>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Incident Notice and Response.</p>
                <ol class="dpa-clauses dpa-clauses--alpha">
                  <li class="dpa-clause">
                    Provider will implement and follow procedures to detect and
                    respond to Security Incidents.
                  </li>
                  <li class="dpa-clause">
                    Provider will: (i) notify Customer without undue delay and,
                    in any event, not later than the Specified Notice Period,
                    after becoming aware of a Security Incident affecting
                    Customer and (ii) make reasonable efforts to identify the
                    cause of the Security Incident, mitigate the effects and
                    remediate the cause to the extent within Provider’s
                    reasonable control.
                  </li>
                  <li class="dpa-clause">
                    Upon Customer’s request and taking into account the nature
                    of the applicable Processing, Provider will assist Customer
                    by providing, when available, information reasonably
                    necessary for Customer to meet its Security Incident
                    notification obligations under Data Protection Laws.
                  </li>
                  <li class="dpa-clause">
                    Customer acknowledges that Provider’s notification of a
                    Security Incident is not an acknowledgement by Provider of
                    its fault or liability.
                  </li>
                  <li class="dpa-clause">
                    Security Incidents do not include unsuccessful attempts or
                    activities that do not compromise the security of Customer
                    Personal Data, including unsuccessful login attempts, pings,
                    port scans, denial of service attacks or other network
                    attacks on firewalls or networked systems.
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Customer Responsibilities.</p>
                <ol class="dpa-clauses dpa-clauses--alpha">
                  <li class="dpa-clause">
                    Customer is responsible for reviewing the information made
                    available by Provider relating to data security and making
                    an independent determination as to whether the Cloud Service
                    meets Customer’s requirements and legal obligations under
                    Data Protection Laws.
                  </li>
                  <li class="dpa-clause">
                    Customer is solely responsible for complying with Security
                    Incident notification laws applicable to Customer and
                    fulfilling any obligations to give notices to government
                    authorities, affected individuals or others relating to any
                    Security Incidents.
                  </li>
                </ol>
              </li>
            </ol>
          </section>

          {/* 6. Data Protection Impact Assessment --------------------------- */}

          <section
            class="dpa-section"
            id={slug(SECTIONS[5])}
            style={{ '--section-num': '"6"' }}
          >
            <h2 class="dpa-heading">Data Protection Impact Assessment</h2>
            <p class="dpa-para">
              Upon Customer’s request and taking into account the nature of the
              applicable Processing, to the extent such information is available
              to Provider, Provider will assist Customer in fulfilling
              Customer’s obligations under Data Protection Laws to carry out a
              data protection impact or similar risk assessment related to
              Customer’s use of the Cloud Service, including, if required by
              Data Protection Laws, by assisting Customer in consultations with
              relevant government authorities.
            </p>
          </section>

          {/* 7. Data Subject Requests --------------------------------------- */}

          <section
            class="dpa-section"
            id={slug(SECTIONS[6])}
            style={{ '--section-num': '"7"' }}
          >
            <h2 class="dpa-heading">Data Subject Requests</h2>
            <ol class="dpa-clauses">
              <li class="dpa-clause">
                <p class="dpa-clause-title">Assisting Customer.</p>
                <p>
                  Upon Customer’s request and taking into account the nature of
                  the applicable Processing, Provider will assist Customer by
                  appropriate technical and organizational measures, insofar as
                  possible, in complying with Customer’s obligations under Data
                  Protection Laws to respond to requests from individuals to
                  exercise their rights under Data Protection Laws, provided
                  that Customer cannot reasonably fulfill such requests
                  independently (including through use of the Cloud Service).
                </p>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Data Subject Requests.</p>
                <p>
                  If Provider receives a request from a Data Subject in relation
                  to the Data Subject’s Customer Personal Data, Provider will
                  notify Customer and advise the Data Subject to submit the
                  request to Customer (but not otherwise communicate with the
                  Data Subject regarding the request except as may be required
                  by Data Protection Laws), and Customer will be responsible for
                  responding to any such request.
                </p>
              </li>
            </ol>
          </section>

          {/* 8. Data Return or Deletion ------------------------------------- */}

          <section
            class="dpa-section"
            id={slug(SECTIONS[7])}
            style={{ '--section-num': '"8"' }}
          >
            <h2 class="dpa-heading">Data Return or Deletion</h2>
            <ol class="dpa-clauses">
              <li class="dpa-clause">
                <p class="dpa-clause-title">During Subscription Term.</p>
                <p>
                  During the Subscription Term, Customer may, through the
                  features of the Cloud Service or such other means specified on
                  the DPA Cover Page, access, return to itself or delete
                  Customer Personal Data.
                </p>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Post Termination.</p>
                <ol class="dpa-clauses dpa-clauses--alpha">
                  <li class="dpa-clause">
                    Following termination or expiration of the Agreement,
                    Provider will, in accordance with its obligations under the
                    Agreement, delete all Customer Personal Data from Provider’s
                    systems.
                  </li>
                  <li class="dpa-clause">
                    Deletion will be in accordance with industry-standard secure
                    deletion practices. Provider will issue a certificate of
                    deletion upon Customer’s request.
                  </li>
                  <li class="dpa-clause">
                    <p>
                      Notwithstanding the foregoing, Provider may retain
                      Customer Personal Data: (i) as required by Data Protection
                      Laws or (ii) in accordance with its standard backup or
                      record retention policies, provided that, in either case,
                      Provider will
                    </p>
                    <p>
                      (x) maintain the confidentiality of, and otherwise comply
                      with the applicable provisions of this DPA with respect
                      to, retained Customer Personal Data and (y) not further
                      Process retained Customer Personal Data except for such
                      purpose(s) and duration specified in such applicable Data
                      Protection Laws.
                    </p>
                  </li>
                </ol>
              </li>
            </ol>
          </section>

          {/* 9. Audits ------------------------------------------------------ */}

          <section
            class="dpa-section"
            id={slug(SECTIONS[8])}
            style={{ '--section-num': '"9"' }}
          >
            <h2 class="dpa-heading">Audits</h2>
            <ol class="dpa-clauses">
              <li class="dpa-clause">
                <p class="dpa-clause-title">Provider Records Generally.</p>
                <p>
                  Provider will keep records of its Processing in compliance
                  with Data Protection Laws and, upon Customer’s request, make
                  available to Customer any records reasonably necessary to
                  demonstrate compliance with Provider’s obligations under this
                  DPA and Data Protection Laws.
                </p>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Third-Party Compliance Program.</p>
                <ol class="dpa-clauses dpa-clauses--alpha">
                  <li class="dpa-clause">
                    Provider will describe its third-party audit and
                    certification programs (if any) and make summary copies of
                    its audit reports (each, an “<strong>Audit Report</strong>
                    ”) available to Customer upon Customer’s written request at
                    reasonable intervals (subject to confidentiality
                    obligations).
                  </li>
                  <li class="dpa-clause">
                    Customer may share a copy of Audit Reports with relevant
                    government authorities as required upon their request.
                  </li>
                  <li class="dpa-clause">
                    Customer agrees that any audit rights granted by Data
                    Protection Laws will be satisfied by Audit Reports and the
                    procedures of Section 9.3 (Customer Audit) below.
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Customer Audit.</p>
                <ol class="dpa-clauses dpa-clauses--alpha">
                  <li class="dpa-clause">
                    Subject to the terms of this Section 9.3, Customer has the
                    right, at Customer’s expense, to conduct an audit of
                    reasonable scope and duration pursuant to a mutually
                    agreed-upon audit plan with Provider that is consistent with
                    the Audit Parameters (an “<strong>Audit</strong>”).
                  </li>
                  <li class="dpa-clause">
                    Customer may exercise its Audit right: (i) to the extent
                    Provider’s provision of an Audit Report does not provide
                    sufficient information for Customer to verify Provider’s
                    compliance with this DPA or the parties’ compliance with
                    Data Protection Laws, (ii) as necessary for Customer to
                    respond to a government authority audit or (iii) in
                    connection with a Security Incident.
                  </li>
                  <li class="dpa-clause">
                    Each Audit must conform to the following parameters (“
                    <strong>Audit Parameters</strong>
                    ”): (i) be conducted by an independent third party that will
                    enter into a confidentiality agreement with Provider, (ii)
                    be limited in scope to matters reasonably required for
                    Customer to assess Provider’s compliance with this DPA and
                    the parties’ compliance with Data Protection Laws, (iii)
                    occur at a mutually agreed date and time and only during
                    Provider’s regular business hours, (iv) occur no more than
                    once annually (unless required under Data Protection Laws or
                    in connection with a Security Incident), (v) cover only
                    facilities controlled by Provider, (vi) restrict findings to
                    Customer Personal Data only and (vii) treat any results as
                    confidential information to the fullest extent permitted by
                    Data Protection Laws.
                  </li>
                </ol>
              </li>
            </ol>
          </section>

          {/* 10. Cross-Border Transfers/Region-Specific Terms --------------- */}

          <section
            class="dpa-section"
            id={slug(SECTIONS[9])}
            style={{ '--section-num': '"10"' }}
          >
            <h2 class="dpa-heading">
              Cross-Border Transfers/Region-Specific Terms
            </h2>
            <ol class="dpa-clauses">
              <li class="dpa-clause">
                <p class="dpa-clause-title">Cross-Border Data Transfers.</p>
                <ol class="dpa-clauses dpa-clauses--alpha">
                  <li class="dpa-clause">
                    Provider (and its Affiliates) may Process and transfer
                    Customer Personal Data globally as necessary to provide the
                    Cloud Service.
                  </li>
                  <li class="dpa-clause">
                    If Provider engages in a Restricted Transfer, it will comply
                    with <u>Schedule 3</u> (Cross-Border Transfer Mechanisms).
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">Region-Specific Terms.</p>
                <p>
                  To the extent that Provider Processes Customer Personal Data
                  protected by Data Protection Laws in one of the regions listed
                  in <u>Schedule 4</u> (Region-Specific Terms), then the terms
                  specified therein with respect to the applicable
                  jurisdiction(s) will apply in addition to the terms of this
                  DPA.
                </p>
              </li>
            </ol>
          </section>

          {/* Schedule 1 ----------------------------------------------------- */}

          <section class="dpa-schedule" id={slug(SCHEDULES[0])}>
            <h2 class="dpa-schedule-heading">
              Schedule 1: Subject Matter and Details of Processing
            </h2>

            <h3 class="dpa-subheading">Customer / “Data Exporter” Details</h3>
            <div class="dpa-table-wrap">
              <table class="dpa-table">
                <tbody>
                  <tr>
                    <th scope="row">Name:</th>
                    <td />
                  </tr>
                  <tr>
                    <th scope="row">Contact details for data protection:</th>
                    <td />
                  </tr>
                  <tr>
                    <th scope="row">Main address:</th>
                    <td />
                  </tr>
                  <tr>
                    <th scope="row">Customer activities:</th>
                    <td />
                  </tr>
                  <tr>
                    <th scope="row">Role:</th>
                    <td>Controller</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 class="dpa-subheading">Provider / “Data Importer” Details</h3>
            <div class="dpa-table-wrap">
              <table class="dpa-table">
                <tbody>
                  <tr>
                    <th scope="row">Name:</th>
                    <td>CoParse, Inc. dba Macro</td>
                  </tr>
                  <tr>
                    <th scope="row">Contact details for data protection:</th>
                    <td>
                      <a href="mailto:support@macro.com">support@macro.com</a>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Main address:</th>
                    <td>
                      54 W 21st St., Unit 503
                      <br />
                      New York NY 10010
                      <br />
                      USA
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Provider activities:</th>
                    <td>Supply and servicing of Macro application</td>
                  </tr>
                  <tr>
                    <th scope="row">Role:</th>
                    <td>Processor</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 class="dpa-subheading">Details of Processing</h3>
            <div class="dpa-table-wrap">
              <table class="dpa-table">
                <tbody>
                  <tr>
                    <th scope="row">Categories of Data Subjects:</th>
                    <td>
                      <em>Customer Employees</em>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Categories of Customer Personal Data:</th>
                    <td>
                      Personal information (name, email, etc.), document data,
                      communications data (internal messaging, email, CRM), code
                      and programming data
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      Sensitive Categories of Data and additional associated
                      restrictions/safeguards:
                    </th>
                    <td>N/A</td>
                  </tr>
                  <tr>
                    <th scope="row">Frequency of transfer:</th>
                    <td>Continuous</td>
                  </tr>
                  <tr>
                    <th scope="row">Nature of the Processing:</th>
                    <td>
                      Web app functionality, license activation and monitoring
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Purpose of the Processing:</th>
                    <td>
                      To ensure timely delivery and services of appropriate
                      features and functionalities
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">
                      Duration of Processing / retention period:
                    </th>
                    <td>
                      Service Term duration of parent Agreement; usage of web
                      app from non-US entities
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Transfers to Subprocessors:</th>
                    <td>
                      Information related to licensing activation and monitoring
                      for the Macro app is transferred, processed, and stored by
                      AWS, alongside other various subprocessors.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Schedule 2 ----------------------------------------------------- */}

          <section class="dpa-schedule" id={slug(SCHEDULES[1])}>
            <h2 class="dpa-schedule-heading">
              Schedule 2: Technical and Organizational Measures
            </h2>
            <p class="dpa-para">
              Macro will maintain technical and organizational safeguards for
              the security, confidentiality, and integrity of Customer’s
              Personal Data uploaded to the Cloud Service as maintained in the
              Agreement. Macro will maintain a consistent overall security level
              for the duration of the Service Term.
            </p>
            <p class="dpa-para">
              Aspects of current technical and organizational measures can be
              seen at Macro’s{' '}
              <a
                href="http://security.macro.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                trust center
              </a>
              .
            </p>
          </section>

          {/* Schedule 3 ----------------------------------------------------- */}

          <section class="dpa-schedule" id={slug(SCHEDULES[2])}>
            <h2 class="dpa-schedule-heading">
              Schedule 3: Cross-Border Transfer Mechanisms
            </h2>
            <ol class="dpa-clauses">
              <li class="dpa-clause">
                <p class="dpa-clause-title">
                  <strong>Definitions</strong>.
                </p>
                <p>
                  Capitalized terms not defined in this Schedule are defined in
                  the DPA.
                </p>
                <ol class="dpa-clauses">
                  <li class="dpa-clause">
                    “<strong>EU Standard Contractual Clauses</strong>” or “
                    <strong>EU SCCs</strong>” means the Standard Contractual
                    Clauses approved by the European Commission in decision
                    2021/914.
                  </li>
                  <li class="dpa-clause">
                    “<strong>UK International Data Transfer Agreement</strong>”
                    means the International Data Transfer Addendum to the EU
                    Commission Standard Contractual Clauses issued by the UK
                    Information Commissioner, Version B1.0, in force as of March
                    21, 2022.
                  </li>
                  <li class="dpa-clause">
                    <p>In addition:</p>
                    <div class="dpa-table-wrap">
                      <table class="dpa-table">
                        <tbody>
                          <tr>
                            <th scope="row">
                              “<strong>Designated EU Governing Law</strong>”
                              means:
                            </th>
                            <td>
                              [<em>parties to specify</em>]
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">
                              “<strong>Designated EU Member State</strong>”
                              means:
                            </th>
                            <td>
                              [<em>parties to specify</em>]
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">
                  <strong>EU Transfers</strong>.
                </p>
                <p>
                  Where Customer Personal Data is protected by EU GDPR and is
                  subject to a Restricted Transfer, the following applies:
                </p>
                <ol class="dpa-clauses">
                  <li class="dpa-clause">
                    <p>
                      The EU SCCs are hereby incorporated by reference as
                      follows:
                    </p>
                    <ol class="dpa-clauses dpa-clauses--alpha">
                      <li class="dpa-clause">
                        Module 2 (Controller to Processor) applies where
                        Customer is a Controller of Customer Personal Data and
                        Provider is a Processor of Customer Personal Data;
                      </li>
                      <li class="dpa-clause">
                        Module 3 (Processor to Processor) applies where Customer
                        is a Processor of Customer Personal Data (on behalf of a
                        third-party Controller) and Provider is a Processor of
                        Customer Personal Data;
                      </li>
                      <li class="dpa-clause">
                        Customer is the "data exporter" and Provider is the
                        "data importer"; and
                      </li>
                      <li class="dpa-clause">
                        by entering into this DPA, each party is deemed to have
                        signed the EU SCCs (including their Annexes) as of the
                        DPA Effective Date.
                      </li>
                    </ol>
                  </li>
                  <li class="dpa-clause">
                    <p>
                      For each Module, where applicable the following applies:
                    </p>
                    <ol class="dpa-clauses dpa-clauses--alpha">
                      <li class="dpa-clause">
                        the optional docking clause in Clause 7 does <u>not</u>{' '}
                        apply;
                      </li>
                      <li class="dpa-clause">
                        in Clause 9, Option 2 will apply, the minimum time
                        period for prior notice of Subprocessor changes shall be
                        as set out in Section 4.3 of this DPA, and Provider
                        shall fulfill its notification obligations by notifying
                        Customer of any Subprocessor changes in accordance with
                        Section 4.3 of this DPA;
                      </li>
                      <li class="dpa-clause">
                        in Clause 11, the optional language does <u>not</u>{' '}
                        apply;
                      </li>
                      <li class="dpa-clause">
                        in Clause 13, all square brackets are removed with the
                        text remaining;
                      </li>
                      <li class="dpa-clause">
                        in Clause 17, Option 1 will apply, and the EU SCCs will
                        be governed by Designated EU Governing Law;
                      </li>
                      <li class="dpa-clause">
                        in Clause 18(b), disputes will be resolved before the
                        courts of the Designated EU Member State;
                      </li>
                      <li class="dpa-clause">
                        <u>Schedule 1</u> (Subject Matter and Details of
                        Processing) to this DPA contains the information
                        required in Annex 1 of the EU SCCs; and
                      </li>
                      <li class="dpa-clause">
                        <u>Schedule 2</u> (Technical and Organizational
                        Measures) to this DPA contains the information required
                        in Annex 2 of the EU SCCs.
                      </li>
                    </ol>
                  </li>
                  <li class="dpa-clause">
                    Where context permits and requires, any reference in this
                    DPA to the EU SCCs shall be read as a reference to the EU
                    SCCs as modified in the manner set forth in this Section 2.
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">
                  <strong>Swiss Transfers</strong>.
                </p>
                <p>
                  Where Customer Personal Data is protected by the FADP and is
                  subject to a Restricted Transfer, the following applies:
                </p>
                <ol class="dpa-clauses">
                  <li class="dpa-clause">
                    <p>
                      The EU SCCs apply as set forth in Section 2 (EU Transfers)
                      of this Schedule 3 with the following modifications:
                    </p>
                    <ol class="dpa-clauses dpa-clauses--alpha">
                      <li class="dpa-clause">
                        in Clause 13, the competent supervisory authority shall
                        be the Swiss Federal Data Protection and Information
                        Commissioner;
                      </li>
                      <li class="dpa-clause">
                        in Clause 17 (Option 1), the EU SCCs will be governed by
                        the laws of Switzerland;
                      </li>
                      <li class="dpa-clause">
                        in Clause 18(b), disputes will be resolved before the
                        courts of Switzerland;
                      </li>
                      <li class="dpa-clause">
                        the term Member State must not be interpreted in such a
                        way as to exclude Data Subjects in Switzerland from
                        enforcing their rights in their place of habitual
                        residence in accordance with Clause 18(c); and
                      </li>
                      <li class="dpa-clause">
                        all references to the EU GDPR in this DPA are also
                        deemed to refer to the FADP.
                      </li>
                    </ol>
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">
                  <strong>UK Transfers</strong>.
                </p>
                <p>
                  Where Customer Personal Data is protected by the UK GDPR and
                  is subject to a Restricted Transfer, the following applies:
                </p>
                <ol class="dpa-clauses">
                  <li class="dpa-clause">
                    <p>
                      The EU SCCs apply as set forth in Section 2 (EU Transfers)
                      of this Schedule 3 with the following modifications:
                    </p>
                    <ol class="dpa-clauses dpa-clauses--alpha">
                      <li class="dpa-clause">
                        each party shall be deemed to have signed the “UK
                        Addendum to the EU Standard Contractual Clauses” (“
                        <strong>UK Addendum</strong>”) issued by the Information
                        Commissioner’s Office under section 119 (A) of the Data
                        Protection Act 2018;
                      </li>
                      <li class="dpa-clause">
                        the EU SCCs shall be deemed amended as specified by the
                        UK Addendum in respect of the transfer of Customer
                        Personal Data;
                      </li>
                      <li class="dpa-clause">
                        in Table 1 of the UK Addendum, the parties’ key contact
                        information is located in <u>Schedule 1</u> (Subject
                        Matter and Details of Processing) to this DPA;
                      </li>
                      <li class="dpa-clause">
                        in Table 2 of the UK Addendum, information about the
                        version of the EU SCCs, modules and selected clauses
                        which this UK Addendum is appended to are located above
                        in this Schedule 3;
                      </li>
                      <li class="dpa-clause">
                        <p>in Table 3 of the UK Addendum:</p>
                        <ol class="dpa-clauses dpa-clauses--roman">
                          <li class="dpa-clause">
                            the list of parties is located in <u>Schedule 1</u>{' '}
                            (Subject Matter and Details of Processing) to this
                            DPA;
                          </li>
                          <li class="dpa-clause">
                            the description of transfer is located in{' '}
                            <u>Schedule 1</u> (Subject Matter and Details of
                            Processing) to this DPA;
                          </li>
                          <li class="dpa-clause">
                            Annex II is located in <u>Schedule 2</u> (Technical
                            and Organizational Measures) to this DPA; and
                          </li>
                          <li class="dpa-clause">
                            the list of Subprocessors is located in{' '}
                            <u>Schedule 1</u> (Subject Matter and Details of
                            Processing) to this DPA.
                          </li>
                        </ol>
                      </li>
                      <li class="dpa-clause">
                        in Table 4 of the UK Addendum, both the Importer and the
                        Exporter may end the UK Addendum in accordance with its
                        terms (and the respective box for each is deemed
                        checked); and
                      </li>
                      <li class="dpa-clause">
                        in Part 2: Part 2 - Mandatory Clauses of the Approved
                        Addendum, being the template Addendum B.1.0 issued by
                        the ICO and laid before Parliament in accordance with
                        section 119 (A) of the Data Protection Act 2018 on 2
                        February 2022, as it is revised under section 18 of
                        those Mandatory Clauses.
                      </li>
                    </ol>
                  </li>
                </ol>
              </li>
            </ol>
          </section>

          {/* Schedule 4 ----------------------------------------------------- */}

          <section class="dpa-schedule" id={slug(SCHEDULES[3])}>
            <h2 class="dpa-schedule-heading">
              Schedule 4: Region-Specific Terms
            </h2>
            {/* The "A." is Word list numbering, so it is generated in CSS like
                every other clause number rather than typed into the text. */}
            <h3 class="dpa-subheading dpa-region">CALIFORNIA</h3>
            <ol class="dpa-clauses">
              <li class="dpa-clause">
                <p class="dpa-clause-title">
                  <strong>Definitions</strong>.
                </p>
                <p>
                  CCPA and other capitalized terms not defined in this Schedule
                  are defined in the DPA.
                </p>
                <ol class="dpa-clauses">
                  <li class="dpa-clause">
                    “business purpose”, “commercial purpose”, “personal
                    information”, “sell”, “service provider” and “share” have
                    the meanings given in the CCPA.
                  </li>
                  <li class="dpa-clause">
                    The definition of “Data Subject” includes “consumer” as
                    defined under the CCPA.
                  </li>
                  <li class="dpa-clause">
                    The definition of “Controller” includes “business” as
                    defined under the CCPA.
                  </li>
                  <li class="dpa-clause">
                    The definition of “Processor” includes “service provider” as
                    defined under the CCPA.
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">
                  <strong>Obligations</strong>.
                </p>
                <ol class="dpa-clauses">
                  <li class="dpa-clause">
                    Customer is providing the Customer Personal Data to Provider
                    under the Agreement for the limited and specific business
                    purposes of providing the Cloud Service as described in{' '}
                    <u>Schedule 1</u> (Subject Matter and Details of Processing)
                    to this DPA and otherwise performing under the Agreement.
                  </li>
                  <li class="dpa-clause">
                    Provider will comply with its applicable obligations under
                    the CCPA and provide the same level of privacy protection to
                    Customer Personal Data as is required by the CCPA.
                  </li>
                  <li class="dpa-clause">
                    Provider acknowledges that Customer has the right to: (i)
                    take reasonable and appropriate steps under Section 9
                    (Audits) of this DPA to help to ensure that Provider’s use
                    of Customer Personal Data is consistent with Customer’s
                    obligations under the CCPA, (ii) receive from Provider
                    notice and assistance under Section 7 (Data Subject
                    Requests) of this DPA regarding consumers’ requests to
                    exercise rights under the CCPA and (iii) upon notice, take
                    reasonable and appropriate steps to stop and remediate
                    unauthorized use of Customer Personal Data.
                  </li>
                  <li class="dpa-clause">
                    Provider will notify Customer promptly after it makes a
                    determination that it can no longer meet its obligations
                    under the CCPA.
                  </li>
                  <li class="dpa-clause">
                    Provider will not retain, use or disclose Customer Personal
                    Data: (i) for any purpose, including a commercial purpose,
                    other than the business purposes described in Section 2.1 of
                    this Section A (California) of Schedule 4 or (ii) outside of
                    the direct business relationship between Provider with
                    Customer, except, in either case, where and to the extent
                    permitted by the CCPA.
                  </li>
                  <li class="dpa-clause">
                    Provider will not sell or share Customer Personal Data
                    received under the Agreement.
                  </li>
                  <li class="dpa-clause">
                    Provider will not combine Customer Personal Data with other
                    personal information except to the extent a service provider
                    is permitted to do so by the CCPA.
                  </li>
                </ol>
              </li>
              <li class="dpa-clause">
                <p class="dpa-clause-title">
                  <strong>Activity Prior to January 1, 2023</strong>.
                </p>
                <p>
                  To the extent this Section A (California) of Schedule 4 is in
                  effect prior to January 1, 2023, Provider’s obligations
                  hereunder that are required solely by amendments to the CCPA
                  made by the California Privacy Rights Act regarding
                  contractual obligations of service providers shall only apply
                  on and after January 1, 2023.
                </p>
              </li>
            </ol>
          </section>
        </div>
      </main>
      <div class="legal-doc-footer">
        <SectionMoreFeatures currentPath="/dpa" footerOnly />
      </div>
    </>
  );
};
