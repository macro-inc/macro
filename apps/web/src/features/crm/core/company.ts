/** Values consumed by company detail surfaces. */
export type CrmCompany = {
  type: 'crm_company';
  id: string;
  name: string;
  ownerId: string;
  teamId: string;
  description?: string;
  hidden: boolean;
  emailSync?: boolean;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  domains: {
    id: string;
    companyId: string;
    domain: string;
    createdAt?: string | Date | null;
  }[];
};
